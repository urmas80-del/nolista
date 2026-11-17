-- NoLista: pre-hardening audit
--
-- READ-ONLY. Run in Supabase Dashboard -> SQL Editor BEFORE applying
-- migrations/20261117000100_security_hardening.sql.
--
-- Every row returned is something to look at. An empty result is good news.
--   finding                    | meaning
--   premium_user               | everyone marked Premium. Expected? If you never
--                              | granted it manually, someone set it themselves.
--   profile_email_mismatch     | profile email differs from login email
--                              | (possible invite hijack). The migration repairs it.
--   collaborator_without_invite| collaborator with no accepted invite for that
--                              | board (possible forced add or hijacked invite).
--   custom_board_free_user     | custom board owned by a non-Premium user.
--                              | Existing boards are kept; only new ones are blocked.
--   recurring_task_free_board  | recurring task on a non-Premium owner's board.
--                              | Kept; just informational.
--   duplicate_builtin_board    | user owns 2+ market/together/focus boards.
--   bad_value                  | values the new CHECK constraints would reject.
--   duplicate_pending_invite   | same email invited twice to the same board;
--                              | the index migration removes the extras.

select 'premium_user' as finding, p.id::text as id, p.email as detail
from public.profiles p
where p.is_premium

union all
select 'profile_email_mismatch', p.id::text,
       coalesce(p.email, '(null)') || ' vs login ' || coalesce(u.email, '(null)')
from public.profiles p
join auth.users u on u.id = p.id
where p.email is distinct from lower(u.email)

union all
select 'collaborator_without_invite', c.id::text,
       'sheet ' || c.sheet_id || ', user ' || coalesce(p.email, c.user_id::text)
from public.sheet_collaborators c
left join public.profiles p on p.id = c.user_id
left join auth.users u on u.id = c.user_id
where not exists (
  select 1 from public.board_invites bi
  where bi.sheet_id = c.sheet_id
    and bi.invited_email = lower(u.email)
    and bi.status = 'accepted'
)

union all
select 'custom_board_free_user', s.id::text, s.name || ' (owner ' || coalesce(p.email, '?') || ')'
from public.task_sheets s
join public.profiles p on p.id = s.owner_id
where s.type = 'custom' and not coalesce(p.is_premium, false)

union all
select 'recurring_task_free_board', t.id::text, t.title || ' on ' || s.name
from public.tasks t
join public.task_sheets s on s.id = t.sheet_id
join public.profiles p on p.id = s.owner_id
where t.recurrence_rule is not null and not coalesce(p.is_premium, false)

union all
select 'duplicate_builtin_board', s.owner_id::text, s.type || ' x' || count(*)
from public.task_sheets s
where s.type in ('market', 'together', 'focus')
group by s.owner_id, s.type
having count(*) > 1

union all
select 'bad_value', s.id::text, 'task_sheets.type = ' || s.type
from public.task_sheets s
where s.type not in ('market', 'together', 'focus', 'custom')

union all
select 'bad_value', t.id::text,
       'tasks recurrence = ' || coalesce(t.recurrence_rule, 'null') || ' / ' || coalesce(t.recurrence_strategy, 'null')
from public.tasks t
where (t.recurrence_rule is not null and t.recurrence_rule not in ('daily', 'weekly', 'monthly'))
   or (t.recurrence_strategy is not null and t.recurrence_strategy not in ('add_on_top', 'recur_on_complete'))

union all
select 'bad_value', bi.id::text, 'board_invites.status = ' || bi.status
from public.board_invites bi
where bi.status not in ('pending', 'accepted', 'declined')

union all
select 'duplicate_pending_invite', bi.sheet_id::text, bi.invited_email || ' x' || count(*)
from public.board_invites bi
where bi.status = 'pending'
group by bi.sheet_id, bi.invited_email
having count(*) > 1

order by 1, 2;
