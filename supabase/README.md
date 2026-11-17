# Database

The Supabase database is defined by the files in `migrations/`, applied in
filename order. Any change to the database (tables, policies, functions,
triggers) goes into a new migration file, never only into the dashboard.

| File | What it is |
|---|---|
| `migrations/20261117000000_baseline.sql` | Production schema as of 2026-11-17. Already applied in production. |
| `migrations/20261117000100_security_hardening.sql` | RLS and function fixes from the security review. |
| `migrations/20261117000200_indexes.sql` | Indexes on foreign keys and invite lookups. |
| `migrations/20261117000300_realtime_tasks.sql` | Publishes `tasks` to Realtime for live shared boards. |
| `tools/inspect-schema.sql` | Read-only export of the live schema, for comparing against these files. |
| `tools/audit-before-hardening.sql` | Read-only check to run before the hardening migration. |

## Apply a migration without the CLI

1. Run `tools/audit-before-hardening.sql` in the SQL Editor and review the rows.
2. Paste the migration into **SQL Editor** and run it. Each migration is
   wrapped in `begin; ... commit;`, so a failure changes nothing.

Try it on a separate test project first: create a free project, run the
baseline, then the newer migrations, and sign in from the app against it.

## Moving to the Supabase CLI (recommended)

```bash
npm install --save-dev supabase
npx supabase init                       # creates supabase/config.toml
npx supabase login
npx supabase link --project-ref <ref>   # ref is in the project URL
# Tell the CLI which migrations production already has:
npx supabase migration repair --status applied 20261117000000
# (also 20261117000100 / 20261117000200 if you applied them in the dashboard)
npx supabase db push                    # applies anything not yet applied
```

New change: `npx supabase migration new <name>`, write SQL, `npx supabase db push`.

## Not in the database

Sign-in code length, email/SMTP setup and rate limits are under
**Authentication** in the dashboard and are not captured here.
`profiles.is_premium` can only be changed by the backend (dashboard or
service role), never by the app.
