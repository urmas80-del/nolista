-- NoLista: unmerge undoes the merge but keeps you on the shared board
--
-- 20261118000200 made unmerge leave the shared board. Unmerge should go back
-- to the "Keep both" state instead:
--   * you stay a member of the shared board;
--   * you get your own board of that type again, with a copy of the items
--     your merge brought in (they also stay on the shared board);
--   * the people your merge brought in move back to your board.
-- tasks.merged_by records whose merge moved an item onto a shared board.

begin;

alter table public.tasks
  add column if not exists merged_by uuid references public.profiles(id) on delete set null;

-- merge_own_board_into: also tag the items it moves.
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

  -- Items the shared list already has open: drop mine, but tag theirs so an
  -- unmerge still gives them back to me.
  update public.tasks t set merged_by = v_uid
  where t.sheet_id = p_target
    and not t.is_done
    and t.merged_by is null
    and exists (
      select 1 from public.tasks mine
      where mine.sheet_id = v_own
        and not mine.is_done
        and lower(trim(mine.title)) = lower(trim(t.title))
    );

  delete from public.tasks mine
  where mine.sheet_id = v_own
    and not mine.is_done
    and exists (
      select 1 from public.tasks t
      where t.sheet_id = p_target
        and not t.is_done
        and lower(trim(t.title)) = lower(trim(mine.title))
    );

  update public.tasks set sheet_id = p_target, merged_by = v_uid where sheet_id = v_own;

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
  v_tagged boolean;
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
  if exists (select 1 from public.task_sheets where owner_id = v_uid and type = v_type) then
    raise exception 'You already have your own % board.', initcap(v_type);
  end if;

  insert into public.task_sheets (owner_id, name, type, caching_enabled)
  values (v_uid, initcap(v_type), v_type, v_type = 'market')
  returning id into v_own;

  -- My items: the ones my merge brought in. Merges from before items were
  -- tagged have none, so fall back to a copy of the whole list.
  v_tagged := exists (select 1 from public.tasks where sheet_id = p_board and merged_by = v_uid);

  -- Copies of existing recurring items are allowed on the free plan.
  perform set_config('nolista.copying_items', 'on', true);

  insert into public.tasks (
    sheet_id, title, is_done, due_date, recurrence_rule, recurrence_strategy,
    next_due_date, recurrence_interval_days, created_by
  )
  select v_own, t.title, t.is_done, t.due_date, t.recurrence_rule, t.recurrence_strategy,
         t.next_due_date, t.recurrence_interval_days, coalesce(t.created_by, v_uid)
  from public.tasks t
  where t.sheet_id = p_board
    and (not v_tagged or t.merged_by = v_uid)
  order by t.created_at;

  perform set_config('nolista.copying_items', 'off', true);

  update public.tasks set merged_by = null where sheet_id = p_board and merged_by = v_uid;

  -- The people my merge brought in go back to my board.
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

create or replace function public.enforce_recurrence_premium()
 returns trigger
 language plpgsql
 security definer
 set search_path = ''
as $function$
begin
  if new.recurrence_rule is null
     or pg_trigger_depth() > 1
     or coalesce(current_setting('nolista.copying_items', true), '') = 'on' then
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

revoke execute on function public.unmerge_board(uuid) from public, anon;
grant execute on function public.unmerge_board(uuid) to authenticated;

commit;
