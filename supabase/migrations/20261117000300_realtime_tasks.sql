-- NoLista: live updates for shared boards
--
-- Publishes changes on public.tasks to Supabase Realtime so everyone viewing
-- a board sees items added, ticked or removed by others immediately.
--
-- Realtime applies the table's RLS policies to every subscriber, so a user
-- only receives INSERT/UPDATE events for boards has_sheet_access() allows.
-- DELETE events cannot be checked against RLS (the row is gone); Supabase
-- sends them with the primary key only, which is a random uuid.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tasks'
  ) then
    alter publication supabase_realtime add table public.tasks;
  end if;
end
$$;
