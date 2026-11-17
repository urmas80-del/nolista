-- NoLista security hardening
--
-- Fixes found in the 2026-11-17 review. Each section says what was wrong.
-- Run supabase/tools/audit-before-hardening.sql first: it shows whether any
-- of these holes were already used and which rows the changes will touch.
--
-- Everything runs in one transaction: if any statement fails, nothing changes.

begin;

-- ===========================================================================
-- 1. Identity: "who am I" must come from auth.users, not from profiles
-- ---------------------------------------------------------------------------
-- Problem: my_email() and accept_board_invite read profiles.email, and users
-- could edit their own profile row. Changing it to someone else's address let
-- you see and accept that person's invites.
-- ===========================================================================

create or replace function public.my_email()
 returns text
 language sql
 stable security definer
 set search_path = ''
as $function$
  select lower(u.email) from auth.users u where u.id = auth.uid();
$function$;

-- Repair any profile emails that drifted from the real account email.
update public.profiles p
set email = lower(u.email)
from auth.users u
where u.id = p.id
  and p.email is distinct from lower(u.email);

-- Keep profiles.email in sync when a user changes their login email.
create or replace function public.handle_user_email_change()
 returns trigger
 language plpgsql
 security definer
 set search_path = ''
as $function$
begin
  update public.profiles set email = lower(new.email) where id = new.id;
  return new;
end;
$function$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.handle_user_email_change();

create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path = ''
as $function$
begin
  insert into public.profiles (id, email)
  values (new.id, lower(new.email));

  insert into public.task_sheets (owner_id, name, type, caching_enabled) values
    (new.id, 'Market', 'market', true),
    (new.id, 'Together', 'together', false),
    (new.id, 'Focus', 'focus', false);

  return new;
end;
$function$;

-- ===========================================================================
-- 2. profiles: users may read their row and change display_name, nothing else
-- ---------------------------------------------------------------------------
-- Problem: "Manage own profile" was FOR ALL, so any user could run
--   update profiles set is_premium = true
-- and unlock Premium for free (or set email, see section 1).
-- ===========================================================================

update public.profiles set is_premium = false where is_premium is null;
alter table public.profiles alter column is_premium set not null;

drop policy if exists "Manage own profile" on public.profiles;

create policy "Read own profile" on public.profiles
  for select to authenticated
  using (id = auth.uid());

create policy "Update own display name" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

revoke insert, update, delete on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;

-- ===========================================================================
-- 3. board_invites
-- ---------------------------------------------------------------------------
-- Problems:
--  a) An invitee could UPDATE any column of their invite, including sheet_id,
--     then call accept_board_invite and join a board they were never invited
--     to.
--  b) Owners could set invited_by to another user, which wrote into that
--     user's sharing circle (and could fill it up).
--  c) Invites to the private "focus" board and to yourself were allowed.
-- ===========================================================================

drop policy if exists "Owners manage invites" on public.board_invites;
drop policy if exists "Invitee can respond to their invite" on public.board_invites;

create policy "Owners view invites" on public.board_invites
  for select to authenticated
  using (public.owns_sheet(sheet_id));

create policy "Owners create invites" on public.board_invites
  for insert to authenticated
  with check (
    public.owns_sheet(sheet_id)
    and invited_by = auth.uid()
    and status = 'pending'
    and invited_email = lower(invited_email)
    and invited_email <> public.my_email()
    and exists (
      select 1 from public.task_sheets s
      where s.id = board_invites.sheet_id and s.type <> 'focus'
    )
  );

create policy "Owners revoke invites" on public.board_invites
  for delete to authenticated
  using (public.owns_sheet(sheet_id));

-- Invitees may only flip their own pending invite to 'declined'.
-- Accepting goes through accept_board_invite().
create policy "Invitee can decline their invite" on public.board_invites
  for update to authenticated
  using (invited_email = public.my_email() and status = 'pending')
  with check (invited_email = public.my_email() and status = 'declined');

revoke update on public.board_invites from authenticated;
grant update (status) on public.board_invites to authenticated;

alter table public.board_invites
  add constraint board_invites_status_check
  check (status in ('pending', 'accepted', 'declined')) not valid;

-- ===========================================================================
-- 4. accept_board_invite
-- ---------------------------------------------------------------------------
-- Problems:
--  a) Trusted profiles.email (section 1).
--  b) Accepting an invite to a CUSTOM board deleted one of your own empty
--     custom boards (or, with p_merge, moved a random custom board's tasks).
--     The "replace my own board" behaviour is only meant for the built-in
--     one-per-person boards (market, together).
--  c) No row lock, so two accepts at once could both run.
-- ===========================================================================

create or replace function public.accept_board_invite(p_invite_id uuid, p_merge boolean default false)
 returns void
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  v_invite public.board_invites%rowtype;
  v_target_type text;
  v_own_sheet_id uuid;
  v_own_task_count int;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  select * into v_invite
  from public.board_invites
  where id = p_invite_id
    and invited_email = public.my_email()
    and status = 'pending'
  for update;

  if not found then
    raise exception 'Invite not found or already handled';
  end if;

  select type into v_target_type from public.task_sheets where id = v_invite.sheet_id;

  if v_target_type in ('market', 'together') then
    select id into v_own_sheet_id
    from public.task_sheets
    where owner_id = auth.uid() and type = v_target_type and id <> v_invite.sheet_id
    limit 1;

    if v_own_sheet_id is not null then
      select count(*) into v_own_task_count from public.tasks where sheet_id = v_own_sheet_id;

      if v_own_task_count = 0 then
        delete from public.task_sheets where id = v_own_sheet_id;
      elsif p_merge then
        update public.tasks set sheet_id = v_invite.sheet_id where sheet_id = v_own_sheet_id;
        delete from public.task_sheets where id = v_own_sheet_id;
      end if;
    end if;
  end if;

  insert into public.sheet_collaborators (sheet_id, user_id, role)
  values (v_invite.sheet_id, auth.uid(), 'editor')
  on conflict (sheet_id, user_id) do nothing;

  update public.board_invites set status = 'accepted' where id = p_invite_id;
end;
$function$;

-- ===========================================================================
-- 5. sheet_collaborators: only join through an accepted invite
-- ---------------------------------------------------------------------------
-- Problem: owners could INSERT any user id as a collaborator directly,
-- skipping the invite, which put boards in strangers' lists and exposed
-- their email through "View collaborators' profiles".
-- The app never inserts here; accept_board_invite() does it.
-- ===========================================================================

drop policy if exists "Owners manage collaborators" on public.sheet_collaborators;

-- Also: a NULL is_premium skipped the free-plan limit entirely.
create or replace function public.enforce_collaborator_limit()
 returns trigger
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  owner_is_premium boolean;
  collaborator_count int;
begin
  select coalesce(p.is_premium, false) into owner_is_premium
  from public.task_sheets s
  join public.profiles p on p.id = s.owner_id
  where s.id = new.sheet_id;

  if not coalesce(owner_is_premium, false) then
    select count(*) into collaborator_count
    from public.sheet_collaborators
    where sheet_id = new.sheet_id;

    if collaborator_count >= 2 then
      raise exception 'Free plan allows up to 2 collaborators per board';
    end if;
  end if;

  return new;
end;
$function$;

-- ===========================================================================
-- 6. known_users: re-inviting someone already in your circle must not count
-- ---------------------------------------------------------------------------
-- Bug: BEFORE INSERT triggers run before ON CONFLICT DO NOTHING, so with a
-- full circle (5) you could not invite an existing contact to another board.
-- ===========================================================================

create or replace function public.enforce_known_user_limit()
 returns trigger
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  owner_is_premium boolean;
  current_count int;
  max_known int;
begin
  if exists (
    select 1 from public.known_users
    where owner_id = new.owner_id and contact_email = new.contact_email
  ) then
    return new;  -- already in the circle; ON CONFLICT will skip the insert
  end if;

  select is_premium into owner_is_premium from public.profiles where id = new.owner_id;
  max_known := case when coalesce(owner_is_premium, false) then 50 else 5 end;

  select count(*) into current_count from public.known_users where owner_id = new.owner_id;

  if current_count >= max_known then
    raise exception 'You can have up to % people in your sharing circle.', max_known;
  end if;

  return new;
end;
$function$;

-- ===========================================================================
-- 7. task_sheets: Premium gate and board types enforced in the database
-- ---------------------------------------------------------------------------
-- Problems:
--  a) Custom boards were Premium only in the app; any user could create up
--     to 5 by calling the API.
--  b) Users could create extra market/together/focus boards.
--  c) Owners could change a board's type after creation.
-- ===========================================================================

alter table public.task_sheets
  add constraint task_sheets_type_check
  check (type in ('market', 'together', 'focus', 'custom')) not valid;

create or replace function public.enforce_sheet_limit()
 returns trigger
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  custom_count int;
  max_custom int := 5;
  v_is_premium boolean;
begin
  if new.type = 'custom' then
    select coalesce(is_premium, false) into v_is_premium
    from public.profiles where id = new.owner_id;

    if not coalesce(v_is_premium, false) then
      raise exception 'Custom boards are part of Nolista Premium.';
    end if;

    select count(*) into custom_count
    from public.task_sheets
    where owner_id = new.owner_id and type = 'custom';

    if custom_count >= max_custom then
      raise exception 'You can have up to % custom boards.', max_custom;
    end if;
  elsif exists (
    select 1 from public.task_sheets
    where owner_id = new.owner_id and type = new.type
  ) then
    raise exception 'You already have a % board.', new.type;
  end if;

  return new;
end;
$function$;

-- Owners may rename and toggle suggestions; type/owner are fixed.
revoke update on public.task_sheets from authenticated;
grant update (name, caching_enabled) on public.task_sheets to authenticated;

-- ===========================================================================
-- 8. tasks: recurring tasks are Premium; validate recurrence values
-- ---------------------------------------------------------------------------
-- Problem: recurrence was Premium only in the app.
-- The check uses the person making the change. Copies created by the
-- recurrence trigger itself (pg_trigger_depth() > 1) are always allowed, so
-- a free collaborator can still tick off a recurring task.
-- ===========================================================================

alter table public.tasks
  add constraint tasks_recurrence_rule_check
  check (recurrence_rule is null or recurrence_rule in ('daily', 'weekly', 'monthly')) not valid;

alter table public.tasks
  add constraint tasks_recurrence_strategy_check
  check (recurrence_strategy is null or recurrence_strategy in ('add_on_top', 'recur_on_complete')) not valid;

alter table public.tasks alter column created_by set default auth.uid();

create or replace function public.enforce_recurrence_premium()
 returns trigger
 language plpgsql
 security definer
 set search_path = ''
as $function$
begin
  if new.recurrence_rule is null or pg_trigger_depth() > 1 then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.recurrence_rule is not distinct from new.recurrence_rule
     and old.recurrence_strategy is not distinct from new.recurrence_strategy then
    return new;
  end if;

  if not coalesce((select is_premium from public.profiles where id = auth.uid()), false) then
    raise exception 'Recurring tasks are part of Nolista Premium.';
  end if;

  return new;
end;
$function$;

drop trigger if exists check_recurrence_premium on public.tasks;
create trigger check_recurrence_premium
  before insert or update of recurrence_rule, recurrence_strategy on public.tasks
  for each row execute function public.enforce_recurrence_premium();

-- ===========================================================================
-- 9. board_item_cache: allow deleting suggestions
-- ---------------------------------------------------------------------------
-- Bug: there was no DELETE policy, so "Clear suggestion history" and the
-- trash icon on a suggestion silently deleted nothing.
-- ===========================================================================

create policy "Delete cache on accessible sheets" on public.board_item_cache
  for delete to authenticated
  using (public.has_sheet_access(sheet_id));

-- ===========================================================================
-- 10. Pin search_path on every SECURITY DEFINER function
-- ---------------------------------------------------------------------------
-- Without it a definer function resolves names using the caller's
-- search_path (Supabase linter: function_search_path_mutable).
-- All bodies already use schema-qualified names, so '' is safe.
-- The two policy helpers are also marked STABLE so Postgres can cache them
-- per query instead of re-running them for every row.
-- ===========================================================================

alter function public.owns_sheet(uuid) set search_path = '';
alter function public.has_sheet_access(uuid) set search_path = '';
alter function public.has_sheet_access(uuid) stable;
alter function public.shares_sheet_with(uuid) set search_path = '';
alter function public.shares_sheet_with(uuid) stable;
alter function public.is_invited_to_sheet(uuid) set search_path = '';
alter function public.remove_known_user(text) set search_path = '';
alter function public.add_known_user_on_invite() set search_path = '';
alter function public.enforce_invite_limit() set search_path = '';
alter function public.enforce_task_limit() set search_path = '';
alter function public.handle_task_recurrence() set search_path = '';
alter function public.upsert_item_cache() set search_path = '';

-- ===========================================================================
-- 11. Least privilege for the anonymous role
-- ---------------------------------------------------------------------------
-- The app only talks to tables after sign-in. Signed-out (anon) clients
-- had full table grants and could call every function, relying on RLS
-- alone. TRUNCATE also bypasses RLS, so nobody outside the backend needs it.
-- ===========================================================================

revoke all on all tables in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.handle_new_user() to supabase_auth_admin;
grant execute on function public.handle_user_email_change() to supabase_auth_admin;

commit;
