-- NoLista: display names, "shared with" labels, merging and leaving boards
--
-- 1. profiles.display_name: 1-40 characters (or not set).
-- 2. board_summaries gets member_names: the other people on each board
--    (owner first, then collaborators by join date), as display name or the
--    part of the email before the @.
-- 3. Leaving a built-in board (Market / Together), or being removed from one,
--    leaves you with your own board of that type holding a copy of its items.
-- 4. merge_into_board(): fold your own Market / Together into a shared one
--    you joined. Your items, suggestion history and the people you shared
--    with move over; your own board is then deleted.
--    accept_board_invite(p_merge => true) uses the same merge.

begin;

-- ===========================================================================
-- 1. Display names
-- ===========================================================================

update public.profiles set display_name = null
where display_name is not null and char_length(trim(display_name)) = 0;

update public.profiles set display_name = left(trim(display_name), 40)
where display_name is not null;

alter table public.profiles
  add constraint profiles_display_name_check
  check (display_name is null or char_length(display_name) between 1 and 40) not valid;

-- ===========================================================================
-- 2. board_summaries.member_names
-- ===========================================================================

create or replace view public.board_summaries
with (security_invoker = true)
as
select
  s.id,
  s.name,
  s.type,
  s.caching_enabled,
  s.owner_id,
  s.created_at,
  (select count(*) from public.tasks t where t.sheet_id = s.id)::int as total_count,
  (select count(*) from public.tasks t where t.sheet_id = s.id and t.is_done)::int as done_count,
  (select count(*) from public.sheet_collaborators c where c.sheet_id = s.id)::int as collaborator_count,
  array(
    select coalesce(p.display_name, split_part(p.email, '@', 1))
    from (
      select s.owner_id as user_id, 0 as ord, s.created_at as since
      union all
      select c.user_id, 1, c.created_at
      from public.sheet_collaborators c
      where c.sheet_id = s.id
    ) m
    join public.profiles p on p.id = m.user_id
    where m.user_id <> auth.uid()
    order by m.ord, m.since
  ) as member_names
from public.task_sheets s
where public.has_sheet_access(s.id);

-- ===========================================================================
-- 3. Leaving a board
-- ===========================================================================

-- Members may remove themselves (owners could already remove anyone).
create policy "Members leave boards" on public.sheet_collaborators
  for delete to authenticated
  using (user_id = auth.uid());

create or replace function public.keep_copy_on_leave()
 returns trigger
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  v_type text;
  v_own uuid;
  v_premium boolean;
  v_room int;
begin
  -- delete_my_account() removes memberships of a user who is going away.
  if coalesce(current_setting('nolista.deleting_account', true), '') = 'on' then
    return old;
  end if;

  -- When the board itself is being deleted (or merged away) it is already
  -- gone here, and there is nothing to copy.
  select type into v_type from public.task_sheets where id = old.sheet_id;
  if v_type is null or v_type not in ('market', 'together') then
    return old;
  end if;

  select id into v_own
  from public.task_sheets
  where owner_id = old.user_id and type = v_type;

  if v_own is null then
    insert into public.task_sheets (owner_id, name, type, caching_enabled)
    values (old.user_id, initcap(v_type), v_type, v_type = 'market')
    returning id into v_own;
  end if;

  select coalesce(is_premium, false) into v_premium from public.profiles where id = old.user_id;
  select (case when v_premium then 2000 else 200 end) - count(*) into v_room
  from public.tasks where sheet_id = v_own;

  -- Copy items, skipping ones already on the list (same name, not done).
  insert into public.tasks (
    sheet_id, title, is_done, due_date, recurrence_rule, recurrence_strategy,
    next_due_date, recurrence_interval_days, created_by
  )
  select v_own, t.title, t.is_done, t.due_date, t.recurrence_rule, t.recurrence_strategy,
         t.next_due_date, t.recurrence_interval_days, old.user_id
  from public.tasks t
  where t.sheet_id = old.sheet_id
    and not exists (
      select 1 from public.tasks mine
      where mine.sheet_id = v_own
        and not mine.is_done
        and lower(trim(mine.title)) = lower(trim(t.title))
    )
  order by t.created_at
  limit greatest(v_room, 0);

  return old;
end;
$function$;

create trigger keep_copy_on_leave
  after delete on public.sheet_collaborators
  for each row execute function public.keep_copy_on_leave();

-- ===========================================================================
-- 4. Merging your own board into a shared one
-- ===========================================================================

-- Internal: does the work for the signed-in user. Not callable from the app.
create or replace function public.merge_own_board_into(p_target uuid)
 returns void
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_target public.task_sheets%rowtype;
  v_own uuid;
begin
  select * into v_target from public.task_sheets where id = p_target for update;
  select id into v_own
  from public.task_sheets
  where owner_id = v_uid and type = v_target.type and id <> p_target
  for update;

  if v_own is null then
    return;
  end if;

  -- Items: drop ones the shared list already has open, move the rest.
  delete from public.tasks mine
  where mine.sheet_id = v_own
    and not mine.is_done
    and exists (
      select 1 from public.tasks t
      where t.sheet_id = p_target
        and not t.is_done
        and lower(trim(t.title)) = lower(trim(mine.title))
    );
  update public.tasks set sheet_id = p_target where sheet_id = v_own;

  -- Suggestion history.
  insert into public.board_item_cache (sheet_id, item_name, normalized_name, use_count, last_used_at)
  select p_target, item_name, normalized_name, use_count, last_used_at
  from public.board_item_cache where sheet_id = v_own
  on conflict (sheet_id, normalized_name) do update
    set use_count = public.board_item_cache.use_count + excluded.use_count,
        last_used_at = greatest(public.board_item_cache.last_used_at, excluded.last_used_at);

  -- People I shared my board with.
  insert into public.sheet_collaborators (sheet_id, user_id, role)
  select p_target, c.user_id, 'editor'
  from public.sheet_collaborators c
  where c.sheet_id = v_own and c.user_id <> v_target.owner_id
  on conflict (sheet_id, user_id) do nothing;

  delete from public.task_sheets where id = v_own;
end;
$function$;

revoke execute on function public.merge_own_board_into(uuid) from public, anon, authenticated;

-- Called by the app from a shared board you joined.
create or replace function public.merge_into_board(p_target uuid)
 returns void
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_target public.task_sheets%rowtype;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select * into v_target from public.task_sheets where id = p_target;

  if not found or not exists (
    select 1 from public.sheet_collaborators
    where sheet_id = p_target and user_id = v_uid
  ) then
    raise exception 'You can only merge into a board that is shared with you.';
  end if;

  if v_target.type not in ('market', 'together') then
    raise exception 'Only Market and Together boards can be merged.';
  end if;

  if not exists (
    select 1 from public.task_sheets where owner_id = v_uid and type = v_target.type
  ) then
    raise exception 'You don''t have your own % board to merge.', initcap(v_target.type);
  end if;

  perform public.merge_own_board_into(p_target);
end;
$function$;

revoke execute on function public.merge_into_board(uuid) from public, anon;
grant execute on function public.merge_into_board(uuid) to authenticated;

-- accept_board_invite: same as before, but replacing your own board now
-- goes through the merge, so the people you shared it with come along
-- instead of losing access.
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

  insert into public.sheet_collaborators (sheet_id, user_id, role)
  values (v_invite.sheet_id, auth.uid(), 'editor')
  on conflict (sheet_id, user_id) do nothing;

  update public.board_invites set status = 'accepted' where id = p_invite_id;

  select type into v_target_type from public.task_sheets where id = v_invite.sheet_id;

  if v_target_type in ('market', 'together') then
    select id into v_own_sheet_id
    from public.task_sheets
    where owner_id = auth.uid() and type = v_target_type and id <> v_invite.sheet_id;

    if v_own_sheet_id is not null then
      select count(*) into v_own_task_count from public.tasks where sheet_id = v_own_sheet_id;
      if v_own_task_count = 0 or p_merge then
        perform public.merge_own_board_into(v_invite.sheet_id);
      end if;
    end if;
  end if;
end;
$function$;

-- ===========================================================================
-- 5. delete_my_account: don't hand a leaving user copies of boards
-- ===========================================================================

create or replace function public.delete_my_account()
 returns void
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_email text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  perform set_config('nolista.deleting_account', 'on', true);

  select lower(email) into v_email from auth.users where id = v_uid;

  delete from public.task_sheets where owner_id = v_uid;

  delete from public.sheet_collaborators where user_id = v_uid;
  update public.tasks set created_by = null where created_by = v_uid;

  delete from public.board_invites where invited_by = v_uid or invited_email = v_email;
  delete from public.known_users where owner_id = v_uid or contact_email = v_email;

  delete from public.profiles where id = v_uid;
  delete from auth.users where id = v_uid;
end;
$function$;

commit;
