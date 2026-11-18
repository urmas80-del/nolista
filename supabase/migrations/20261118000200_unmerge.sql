-- NoLista: unmerge a Market / Together board
--
-- Merging (20261118000100) moves your items and the people you shared your
-- board with onto a shared board. Unmerging undoes that:
--   * you leave the shared board and get your own board of that type back,
--     with a copy of the items (keep_copy_on_leave does this);
--   * the people who came in with your merge move back to your board.
-- To know who came in with whom, sheet_collaborators.added_by records the
-- member whose merge brought them.

begin;

alter table public.sheet_collaborators
  add column if not exists added_by uuid references public.profiles(id) on delete set null;

-- keep_copy_on_leave: also skip while unmerge_board() moves people back.
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
  if coalesce(current_setting('nolista.deleting_account', true), '') = 'on'
     or coalesce(current_setting('nolista.moving_members', true), '') = 'on' then
    return old;
  end if;

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

-- merge_own_board_into: same as before, and remember who brought whom.
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

  insert into public.board_item_cache (sheet_id, item_name, normalized_name, use_count, last_used_at)
  select p_target, item_name, normalized_name, use_count, last_used_at
  from public.board_item_cache where sheet_id = v_own
  on conflict (sheet_id, normalized_name) do update
    set use_count = public.board_item_cache.use_count + excluded.use_count,
        last_used_at = greatest(public.board_item_cache.last_used_at, excluded.last_used_at);

  insert into public.sheet_collaborators (sheet_id, user_id, role, added_by)
  select p_target, c.user_id, 'editor', v_uid
  from public.sheet_collaborators c
  where c.sheet_id = v_own and c.user_id <> v_target.owner_id
  on conflict (sheet_id, user_id) do nothing;

  delete from public.task_sheets where id = v_own;
end;
$function$;

revoke execute on function public.merge_own_board_into(uuid) from public, anon, authenticated;

create or replace function public.unmerge_board(p_board uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_type text;
  v_own uuid;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select s.type into v_type
  from public.task_sheets s
  join public.sheet_collaborators c on c.sheet_id = s.id and c.user_id = v_uid
  where s.id = p_board
  for update of s;

  if v_type is null then
    raise exception 'You can only unmerge a board that is shared with you.';
  end if;
  if v_type not in ('market', 'together') then
    raise exception 'Only Market and Together boards can be unmerged.';
  end if;

  -- Leaving gives me my own board back with a copy of the items.
  delete from public.sheet_collaborators where sheet_id = p_board and user_id = v_uid;

  select id into v_own from public.task_sheets where owner_id = v_uid and type = v_type;

  -- Move the people my merge brought in back to my board.
  perform set_config('nolista.moving_members', 'on', true);

  insert into public.sheet_collaborators (sheet_id, user_id, role)
  select v_own, c.user_id, 'editor'
  from public.sheet_collaborators c
  where c.sheet_id = p_board and c.added_by = v_uid
  on conflict (sheet_id, user_id) do nothing;

  delete from public.sheet_collaborators where sheet_id = p_board and added_by = v_uid;

  perform set_config('nolista.moving_members', 'off', true);

  return v_own;
end;
$function$;

revoke execute on function public.unmerge_board(uuid) from public, anon;
grant execute on function public.unmerge_board(uuid) to authenticated;

commit;
