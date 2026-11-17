-- NoLista: one query for the board list
--
-- Home and Settings used to run 1-2 count queries per board (N+1). This view
-- returns every board the user can open, with its item and collaborator
-- counts, in a single request.
--
-- security_invoker = true: the view runs with the caller's permissions, so
-- the RLS policies on task_sheets, tasks and sheet_collaborators still apply.
--
-- It also fixes a bug: task_sheets' "Invitee can view invited sheet name"
-- policy made boards you were only INVITED to appear in the board list
-- before accepting. has_sheet_access() limits this to owned/joined boards.

begin;

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
  (select count(*) from public.sheet_collaborators c where c.sheet_id = s.id)::int as collaborator_count
from public.task_sheets s
where public.has_sheet_access(s.id);

revoke all on public.board_summaries from anon;
grant select on public.board_summaries to authenticated;

commit;
