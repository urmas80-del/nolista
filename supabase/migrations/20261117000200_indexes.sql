-- NoLista: indexes for the queries the app and the RLS policies run
--
-- Postgres does not index foreign keys automatically. Every RLS check
-- (has_sheet_access, owns_sheet, my_email lookups) and every board/task list
-- query filters on these columns.

begin;

create index if not exists tasks_sheet_id_created_at_idx
  on public.tasks (sheet_id, created_at);

create index if not exists task_sheets_owner_id_idx
  on public.task_sheets (owner_id);

create index if not exists sheet_collaborators_user_id_idx
  on public.sheet_collaborators (user_id);

create index if not exists board_invites_invited_email_pending_idx
  on public.board_invites (invited_email)
  where status = 'pending';

create index if not exists profiles_email_idx
  on public.profiles (email);

-- One pending invite per email per board. Pressing "Invite" twice used to
-- create two invites and two banners for the invitee. Remove existing
-- duplicates first (keep the oldest), then enforce it.
delete from public.board_invites bi
using public.board_invites older
where bi.status = 'pending'
  and older.status = 'pending'
  and older.sheet_id = bi.sheet_id
  and older.invited_email = bi.invited_email
  and (older.created_at, older.id) < (bi.created_at, bi.id);

create unique index if not exists board_invites_one_pending_per_email_idx
  on public.board_invites (sheet_id, invited_email)
  where status = 'pending';

commit;
