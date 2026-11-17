# Nolista

Shared lists for families: a grocery list that remembers what you buy, a
shared "together" board, a private focus list, and custom boards. Built with
Expo (SDK 57, Expo Router) and Supabase.

## Features

- Email sign-in with a one-time code
- Built-in boards (Market, Together, Focus) and Premium custom boards
- Share boards by email; collaborators see changes live (Supabase Realtime)
- Smart suggestions from items you've added before
- Recurring items (Premium)
- A "sharing circle" of people you share with

## Getting started

Requirements: Node.js 20+ (LTS), and Expo Go or an Android/iOS emulator.

```bash
npm install
cp .env.example .env      # PowerShell: Copy-Item .env.example .env
```

Fill in `.env` from the Supabase dashboard (**Project Settings → API**):

```
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon or sb_publishable_ key>
```

Use the anon/publishable key only. Never put the `service_role` or
`sb_secret_` key in the app.

```bash
npx expo start            # then press a (Android), i (iOS) or w (web)
npx expo start --clear    # after changing .env
npx expo start --tunnel   # if your phone can't reach your computer
```

## Database

The schema, security policies and functions live in
[`supabase/migrations`](supabase/migrations). Every database change goes into
a new migration file. See [`supabase/README.md`](supabase/README.md) for how
to apply them.

Premium is a flag on `profiles.is_premium`; it can only be set from the
Supabase dashboard (or the service role), not from the app.

## Project layout

```
src/app/                 routes (Expo Router)
  _layout.tsx            root stack; signed-in vs signed-out screens
  sign-in.tsx
  (tabs)/index.tsx       Home: your boards and pending invites
  (tabs)/settings.tsx
  board/[id].tsx         a board's items
  people.tsx             your sharing circle
src/components/          screens and modals used by the routes
src/constants/           brand colours/fonts, board types
src/utils/errors.ts      Supabase error -> user-facing message
lib/supabase.js          Supabase client
supabase/                migrations and SQL tools
```

## Scripts

| Command | What it does |
|---|---|
| `npm start` | Start the Expo dev server |
| `npm run typecheck` | TypeScript check (`tsc --noEmit`) |
| `npm run lint` | ESLint via `expo lint` |
