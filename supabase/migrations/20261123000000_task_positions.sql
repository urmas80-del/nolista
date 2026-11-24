-- Manual order for items (drag to reorder).
--
-- tasks.position is a float: moving an item writes one row, with a value
-- halfway between its new neighbours. New items, and items that arrive from
-- another board (merge), go to the end of the list.

alter table public.tasks add column if not exists position double precision;

-- Existing items keep the order they had (creation order), 1024 apart.
update public.tasks t
set position = s.rn * 1024
from (
  select id, row_number() over (partition by sheet_id order by created_at, id) as rn
  from public.tasks
) s
where s.id = t.id
  and t.position is null;

-- Append when no position is given, or when an item moves to another board.
-- Inside one INSERT ... SELECT or UPDATE, each row sees the rows before it,
-- so bulk copies (merge, leave, unmerge) keep their order at the end.
create or replace function public.set_task_position()
 returns trigger
 language plpgsql
 security definer
 set search_path = ''
as $function$
begin
  if (tg_op = 'INSERT' and new.position is null)
     or (tg_op = 'UPDATE' and new.sheet_id is distinct from old.sheet_id) then
    select coalesce(max(t.position), 0) + 1024
    into new.position
    from public.tasks t
    where t.sheet_id = new.sheet_id;
  end if;
  return new;
end;
$function$;

drop trigger if exists set_task_position on public.tasks;
create trigger set_task_position
  before insert or update of sheet_id on public.tasks
  for each row execute function public.set_task_position();

alter table public.tasks alter column position set not null;

create index if not exists tasks_sheet_position_idx on public.tasks (sheet_id, position);
