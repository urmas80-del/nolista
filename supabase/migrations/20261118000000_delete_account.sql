-- NoLista: let users delete their own account
--
-- Required by the App Store (guideline 5.1.1(v)) and Google Play: an app with
-- account sign-up must let users delete the account and its data from inside
-- the app.
--
-- What is deleted:
--   * boards the user owns, with their items, collaborators, invites and
--     suggestion history (via ON DELETE CASCADE). Shared boards they own are
--     removed for everyone; the app warns about this before confirming.
--   * their membership on other people's boards. Items they added there stay
--     (other people's lists), with created_by cleared.
--   * invites they sent, invites addressed to their email, and their email in
--     anyone's sharing circle (known_users).
--   * their profile and their login (auth.users, which cascades to sessions
--     and identities).

begin;

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

  select lower(email) into v_email from auth.users where id = v_uid;

  -- Boards I own and everything in them.
  delete from public.task_sheets where owner_id = v_uid;

  -- My membership and authorship on other people's boards.
  delete from public.sheet_collaborators where user_id = v_uid;
  update public.tasks set created_by = null where created_by = v_uid;

  -- Invites from or to me, and my email in anyone's sharing circle.
  delete from public.board_invites where invited_by = v_uid or invited_email = v_email;
  delete from public.known_users where owner_id = v_uid or contact_email = v_email;

  delete from public.profiles where id = v_uid;
  delete from auth.users where id = v_uid;
end;
$function$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

commit;
