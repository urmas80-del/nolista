-- NoLista baseline schema
--
-- Reproduces the production database exactly as it was on 2026-11-17
-- (taken from supabase/tools/inspect-schema.sql). It intentionally includes
-- the security problems fixed in 20261117000100_security_hardening.sql, so
-- that "baseline + later migrations" always equals production.
--
-- Production ALREADY has all of this. Do not run it there. When the Supabase
-- CLI is linked, mark it as applied instead:
--   supabase migration repair --status applied 20261117000000
--
-- Table grants are not listed: Supabase's default privileges grant
-- anon/authenticated/service_role access to new public tables automatically.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid not null,
  email text,
  display_name text,
  is_premium boolean default false,
  created_at timestamp with time zone default now(),
  constraint profiles_pkey primary key (id),
  constraint profiles_id_fkey foreign key (id) references auth.users(id)
);

create table public.task_sheets (
  id uuid default gen_random_uuid() not null,
  owner_id uuid not null,
  name text not null,
  type text default 'custom'::text not null,
  caching_enabled boolean default false not null,
  created_at timestamp with time zone default now(),
  constraint task_sheets_pkey primary key (id),
  constraint task_sheets_owner_id_fkey foreign key (owner_id) references public.profiles(id)
);

create table public.tasks (
  id uuid default gen_random_uuid() not null,
  sheet_id uuid not null,
  title text not null,
  is_done boolean default false not null,
  due_date date,
  recurrence_rule text,
  recurrence_strategy text,
  next_due_date date,
  created_at timestamp with time zone default now(),
  created_by uuid,
  recurrence_interval_days integer,
  constraint tasks_pkey primary key (id),
  constraint tasks_sheet_id_fkey foreign key (sheet_id) references public.task_sheets(id) on delete cascade,
  constraint tasks_created_by_fkey foreign key (created_by) references public.profiles(id)
);

create table public.sheet_collaborators (
  id uuid default gen_random_uuid() not null,
  sheet_id uuid not null,
  user_id uuid not null,
  role text default 'editor'::text not null,
  created_at timestamp with time zone default now(),
  constraint sheet_collaborators_pkey primary key (id),
  constraint sheet_collaborators_sheet_id_user_id_key unique (sheet_id, user_id),
  constraint sheet_collaborators_sheet_id_fkey foreign key (sheet_id) references public.task_sheets(id) on delete cascade,
  constraint sheet_collaborators_user_id_fkey foreign key (user_id) references public.profiles(id)
);

create table public.board_invites (
  id uuid default gen_random_uuid() not null,
  sheet_id uuid not null,
  invited_email text not null,
  invited_by uuid not null,
  status text default 'pending'::text not null,
  created_at timestamp with time zone default now(),
  constraint board_invites_pkey primary key (id),
  constraint board_invites_sheet_id_fkey foreign key (sheet_id) references public.task_sheets(id) on delete cascade,
  constraint board_invites_invited_by_fkey foreign key (invited_by) references public.profiles(id)
);

create table public.board_item_cache (
  id uuid default gen_random_uuid() not null,
  sheet_id uuid not null,
  item_name text not null,
  normalized_name text not null,
  use_count integer default 1 not null,
  last_used_at timestamp with time zone default now(),
  constraint board_item_cache_pkey primary key (id),
  constraint board_item_cache_sheet_id_normalized_name_key unique (sheet_id, normalized_name),
  constraint board_item_cache_sheet_id_fkey foreign key (sheet_id) references public.task_sheets(id) on delete cascade
);

create table public.known_users (
  id uuid default gen_random_uuid() not null,
  owner_id uuid not null,
  contact_email text not null,
  created_at timestamp with time zone default now(),
  constraint known_users_pkey primary key (id),
  constraint known_users_owner_id_contact_email_key unique (owner_id, contact_email),
  constraint known_users_owner_id_fkey foreign key (owner_id) references public.profiles(id)
);

-- ---------------------------------------------------------------------------
-- Helper functions used by RLS policies
-- ---------------------------------------------------------------------------

create or replace function public.my_email()
 returns text
 language sql
 stable security definer
as $function$
  select email from public.profiles where id = auth.uid();
$function$;

create or replace function public.owns_sheet(sheet uuid)
 returns boolean
 language sql
 stable security definer
as $function$
  select exists (
    select 1 from public.task_sheets s where s.id = sheet and s.owner_id = auth.uid()
  );
$function$;

create or replace function public.has_sheet_access(sheet uuid)
 returns boolean
 language sql
 security definer
as $function$
  select exists (
    select 1 from public.task_sheets s
    where s.id = sheet and s.owner_id = auth.uid()
  ) or exists (
    select 1 from public.sheet_collaborators c
    where c.sheet_id = sheet and c.user_id = auth.uid()
  );
$function$;

create or replace function public.is_invited_to_sheet(sheet uuid)
 returns boolean
 language sql
 stable security definer
as $function$
  select exists (
    select 1 from public.board_invites bi
    where bi.sheet_id = sheet
      and bi.invited_email = public.my_email()
      and bi.status = 'pending'
  );
$function$;

create or replace function public.shares_sheet_with(other uuid)
 returns boolean
 language sql
 security definer
as $function$
  select exists (
    select 1
    from public.task_sheets s
    left join public.sheet_collaborators c on c.sheet_id = s.id
    where (s.owner_id = auth.uid() or c.user_id = auth.uid())
      and (
        s.owner_id = other
        or exists (
          select 1 from public.sheet_collaborators c2
          where c2.sheet_id = s.id and c2.user_id = other
        )
      )
  );
$function$;

-- ---------------------------------------------------------------------------
-- RPCs called by the app
-- ---------------------------------------------------------------------------

create or replace function public.accept_board_invite(p_invite_id uuid, p_merge boolean default false)
 returns void
 language plpgsql
 security definer
as $function$
declare
  v_invite record;
  v_target_type text;
  v_own_sheet_id uuid;
  v_own_task_count int;
  v_my_email text;
begin
  select email into v_my_email from public.profiles where id = auth.uid();

  select * into v_invite
  from public.board_invites
  where id = p_invite_id and invited_email = v_my_email and status = 'pending';

  if not found then
    raise exception 'Invite not found or already handled';
  end if;

  select type into v_target_type from public.task_sheets where id = v_invite.sheet_id;

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

  insert into public.sheet_collaborators (sheet_id, user_id, role)
  values (v_invite.sheet_id, auth.uid(), 'editor')
  on conflict (sheet_id, user_id) do nothing;

  update public.board_invites set status = 'accepted' where id = p_invite_id;
end;
$function$;

create or replace function public.remove_known_user(p_contact_email text)
 returns void
 language plpgsql
 security definer
as $function$
begin
  delete from public.sheet_collaborators
  where user_id = (select id from public.profiles where email = p_contact_email)
    and sheet_id in (select id from public.task_sheets where owner_id = auth.uid());

  delete from public.board_invites
  where invited_email = p_contact_email and invited_by = auth.uid();

  delete from public.known_users
  where owner_id = auth.uid() and contact_email = p_contact_email;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Trigger functions
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
as $function$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);

  insert into public.task_sheets (owner_id, name, type, caching_enabled) values
    (new.id, 'Market', 'market', true),
    (new.id, 'Together', 'together', false),
    (new.id, 'Focus', 'focus', false);

  return new;
end;
$function$;

create or replace function public.add_known_user_on_invite()
 returns trigger
 language plpgsql
 security definer
as $function$
begin
  insert into public.known_users (owner_id, contact_email)
  values (new.invited_by, new.invited_email)
  on conflict (owner_id, contact_email) do nothing;
  return new;
end;
$function$;

create or replace function public.enforce_collaborator_limit()
 returns trigger
 language plpgsql
as $function$
declare
  owner_is_premium boolean;
  collaborator_count int;
begin
  select p.is_premium into owner_is_premium
  from public.task_sheets s
  join public.profiles p on p.id = s.owner_id
  where s.id = new.sheet_id;

  if not owner_is_premium then
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

create or replace function public.enforce_invite_limit()
 returns trigger
 language plpgsql
 security definer
as $function$
declare
  invite_count int;
begin
  select count(*) into invite_count
  from public.board_invites
  where sheet_id = new.sheet_id and status = 'pending';

  if invite_count >= 20 then
    raise exception 'Too many pending invites on this board already.';
  end if;

  return new;
end;
$function$;

create or replace function public.enforce_known_user_limit()
 returns trigger
 language plpgsql
 security definer
as $function$
declare
  owner_is_premium boolean;
  current_count int;
  max_known int;
begin
  select is_premium into owner_is_premium from public.profiles where id = new.owner_id;
  max_known := case when owner_is_premium then 50 else 5 end;

  select count(*) into current_count from public.known_users where owner_id = new.owner_id;

  if current_count >= max_known then
    raise exception 'You can have up to % people in your sharing circle.', max_known;
  end if;

  return new;
end;
$function$;

create or replace function public.enforce_sheet_limit()
 returns trigger
 language plpgsql
 security definer
as $function$
declare
  custom_count int;
  max_custom int := 5;
begin
  if new.type = 'custom' then
    select count(*) into custom_count
    from public.task_sheets
    where owner_id = new.owner_id and type = 'custom';

    if custom_count >= max_custom then
      raise exception 'You can have up to % custom boards.', max_custom;
    end if;
  end if;

  return new;
end;
$function$;

create or replace function public.enforce_task_limit()
 returns trigger
 language plpgsql
 security definer
as $function$
declare
  owner_is_premium boolean;
  task_count int;
  max_tasks int;
begin
  select p.is_premium into owner_is_premium
  from public.task_sheets s
  join public.profiles p on p.id = s.owner_id
  where s.id = new.sheet_id;

  max_tasks := case when owner_is_premium then 2000 else 200 end;

  select count(*) into task_count from public.tasks where sheet_id = new.sheet_id;

  if task_count >= max_tasks then
    raise exception 'This board has reached its item limit (%).', max_tasks;
  end if;

  return new;
end;
$function$;

create or replace function public.handle_task_recurrence()
 returns trigger
 language plpgsql
 security definer
as $function$
declare
  v_base_date date;
  v_next_date date;
begin
  if new.is_done = true and old.is_done = false and new.recurrence_rule is not null then
    v_base_date := coalesce(new.due_date, current_date);

    v_next_date := case new.recurrence_rule
      when 'daily' then v_base_date + interval '1 day'
      when 'weekly' then v_base_date + interval '7 days'
      when 'monthly' then v_base_date + interval '1 month'
      else v_base_date + interval '1 day'
    end;

    if new.recurrence_strategy = 'recur_on_complete' then
      update public.tasks
      set is_done = false,
          due_date = v_next_date,
          next_due_date = v_next_date
      where id = new.id;
    else
      insert into public.tasks (
        sheet_id, title, is_done, due_date, recurrence_rule, recurrence_strategy, next_due_date, created_by
      ) values (
        new.sheet_id, new.title, false, v_next_date, new.recurrence_rule, new.recurrence_strategy, v_next_date, new.created_by
      );
    end if;
  end if;

  return new;
end;
$function$;

create or replace function public.upsert_item_cache()
 returns trigger
 language plpgsql
 security definer
as $function$
declare
  sheet_caching boolean;
  owner_is_premium boolean;
  max_cache_entries int;
begin
  select caching_enabled into sheet_caching from public.task_sheets where id = new.sheet_id;

  if sheet_caching then
    insert into public.board_item_cache (sheet_id, item_name, normalized_name, use_count, last_used_at)
    values (new.sheet_id, new.title, lower(trim(new.title)), 1, now())
    on conflict (sheet_id, normalized_name)
    do update set use_count = board_item_cache.use_count + 1, last_used_at = now();

    select p.is_premium into owner_is_premium
    from public.task_sheets s join public.profiles p on p.id = s.owner_id
    where s.id = new.sheet_id;

    max_cache_entries := case when owner_is_premium then 1000 else 300 end;

    delete from public.board_item_cache
    where id in (
      select id from public.board_item_cache
      where sheet_id = new.sheet_id
      order by last_used_at desc
      offset max_cache_entries
    );
  end if;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.task_sheets enable row level security;
alter table public.tasks enable row level security;
alter table public.sheet_collaborators enable row level security;
alter table public.board_invites enable row level security;
alter table public.board_item_cache enable row level security;
alter table public.known_users enable row level security;

-- profiles
create policy "Manage own profile" on public.profiles
  as permissive for all to public
  using ((id = auth.uid()));

create policy "View collaborators' profiles" on public.profiles
  as permissive for select to public
  using (shares_sheet_with(id));

create policy "Invitee can view inviter profile" on public.profiles
  as permissive for select to public
  using ((exists ( select 1
     from board_invites bi
    where ((bi.invited_by = profiles.id) and (bi.invited_email = my_email()) and (bi.status = 'pending'::text)))));

-- task_sheets
create policy "Access own or shared sheets" on public.task_sheets
  as permissive for select to public
  using (((owner_id = auth.uid()) or has_sheet_access(id)));

create policy "Invitee can view invited sheet name" on public.task_sheets
  as permissive for select to public
  using (is_invited_to_sheet(id));

create policy "Owners manage their sheets" on public.task_sheets
  as permissive for all to public
  using ((owner_id = auth.uid()));

-- tasks
create policy "View tasks on accessible sheets" on public.tasks
  as permissive for select to public
  using (has_sheet_access(sheet_id));

create policy "Edit tasks on accessible sheets" on public.tasks
  as permissive for all to public
  using (has_sheet_access(sheet_id));

-- sheet_collaborators
create policy "View collaborators on accessible sheets" on public.sheet_collaborators
  as permissive for select to public
  using (has_sheet_access(sheet_id));

create policy "Owners manage collaborators" on public.sheet_collaborators
  as permissive for insert to public
  with check ((exists ( select 1
     from task_sheets s
    where ((s.id = sheet_collaborators.sheet_id) and (s.owner_id = auth.uid())))));

create policy "Owners remove collaborators" on public.sheet_collaborators
  as permissive for delete to public
  using ((exists ( select 1
     from task_sheets s
    where ((s.id = sheet_collaborators.sheet_id) and (s.owner_id = auth.uid())))));

-- board_invites
create policy "Owners manage invites" on public.board_invites
  as permissive for all to public
  using (owns_sheet(sheet_id));

create policy "Invitee can view their invites" on public.board_invites
  as permissive for select to public
  using ((invited_email = my_email()));

create policy "Invitee can respond to their invite" on public.board_invites
  as permissive for update to public
  using ((invited_email = my_email()));

-- board_item_cache
create policy "View cache on accessible sheets" on public.board_item_cache
  as permissive for select to public
  using (has_sheet_access(sheet_id));

-- known_users
create policy "Manage own known users" on public.known_users
  as permissive for all to public
  using ((owner_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create trigger check_invite_limit
  before insert on public.board_invites
  for each row execute function public.enforce_invite_limit();

create trigger on_invite_add_known_user
  after insert on public.board_invites
  for each row execute function public.add_known_user_on_invite();

create trigger check_known_user_limit
  before insert on public.known_users
  for each row execute function public.enforce_known_user_limit();

create trigger check_collaborator_limit
  before insert on public.sheet_collaborators
  for each row execute function public.enforce_collaborator_limit();

create trigger check_sheet_limit
  before insert on public.task_sheets
  for each row execute function public.enforce_sheet_limit();

create trigger cache_new_task
  after insert on public.tasks
  for each row execute function public.upsert_item_cache();

create trigger check_task_limit
  before insert on public.tasks
  for each row execute function public.enforce_task_limit();

create trigger on_task_recurrence
  after update on public.tasks
  for each row execute function public.handle_task_recurrence();
