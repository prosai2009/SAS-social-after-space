# SAS — SOCIAL AFTER SPACE

> **YOUR PEOPLE. YOUR SPACE. YOUR UNIVERSE.**

SAS is a private social universe with a **Cyberfunk** identity — dark charcoal glass, electric
cyan and neon purple light, acid-green stickers, digital grids, glitch edges and street-style
typography. It feels like an underground operating system from 2040, not a SaaS dashboard.

**Version 1.5** — authentication, profiles, friends, close friends, a shared feed with
post visibility, real-time chat with unread badges, typing signals and read receipts,
and full settings.

---

## TECH STACK

| Layer     | Tech |
|-----------|------|
| Frontend  | React 18 · Vite · JavaScript · CSS · Framer Motion · Lucide icons · react-router |
| Backend   | Supabase — Auth · PostgreSQL · Storage · Realtime |
| Security  | Row Level Security on every table (see `supabase/schema.sql`) |
| Audio     | Looped city theme with auto-start and tab-blur fades (`public/city-theme.mp3`) |

---

## QUICK START

### 1. Install Node.js
Download the LTS from <https://nodejs.org> (18+). Verify with `node -v`.

### 2. Install dependencies
```bash
npm install
```

### 3. Create the Supabase backend (free, ~5 minutes)
1. Create a project at <https://supabase.com>.
2. Open **SQL Editor** in the Supabase dashboard, paste the entire contents of
   **`supabase/schema.sql`** and run it. This creates:
   - every table (profiles, friendships, close_friends, posts, likes, reactions,
     comments, conversations, messages, blocks, notifications)
   - every Row Level Security policy (post visibility, close-friends checks,
     block enforcement, message privacy)
   - the signup trigger that auto-creates profiles
   - the `delete_account` function
   - three public storage buckets (`avatars`, `post-images`, `chat-images`)
     with file-type and size limits
   - Realtime publications for chat + notifications
   > **Already have a SAS project?** Run **`supabase/upgrade_v1.5_chat.sql`** once
   > instead (adds unread counts, read receipts and ReSync edits without touching
   > existing data).
3. Go to **Project Settings → API** and copy the **Project URL** and the
   **anon public** key.

### 4. Configure the app
Copy `.env.example` to `.env` in the project root and fill it in:

```
VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR-ANON-PUBLIC-KEY
```

> ⚠️ **Only the public anon key goes here — never the service_role key.** The anon key
> is safe to expose because *all* privacy is enforced server-side by RLS policies,
> not by the frontend.

### 5. Run it
```bash
npm run dev
```
Open <http://localhost:5173>. Press **ENTER THE SPACE** on the intro screen.
Music starts automatically when the browser allows it and fades out when you
switch tabs; the **MUSIC** toggle in the sidebar turns it off for good.

### 6. Production build
```bash
npm run build
npm run preview
```

---

## SUPABASE DASHBOARD SETTINGS (recommended)

- **Authentication → URL Configuration → Site URL**: `http://localhost:5173`
  (add your production URL later).
- **Authentication → Providers → Email**: keep "Confirm email" ON for security.
  Turn it OFF if you want instant signups while testing.
- **Password recovery** works out of the box — the email link redirects to
  `/reset` where the user sets a new password.

---

## FEATURES (V1.0)

- **Intro experience** — animated SAS logo with cyan/purple light + glitch,
  "WELCOME TO ANOTHER SPACE", click-to-enter. Never replays on navigation
  (session-guarded).
- **Auth** — signup (unique username + display name), login, logout, password
  recovery, persistent sessions, account deletion.
- **Profiles** — futuristic identity cards: avatar upload, display name, bio,
  status, identity colour, joined date, their visible posts.
- **Friends** — username search, send/accept/decline/cancel requests, remove
  friends, online indicators (90s presence window), duplicate/self-request
  prevention enforced in the database.
- **Close Friends** — the inner circle. Posts marked CLOSE are only readable by
  the author's circle — verified by a `SECURITY DEFINER` function in RLS, not by
  hiding elements.
- **Shared feed** — text posts (image upload temporarily off), three visibility
  levels (PUBLIC / FRIENDS / CLOSE), likes, emoji reactions, comments, delete
  own posts, change visibility of own posts, relative timestamps.
- **Chat** — one-to-one real-time messaging (Supabase Realtime), conversation
  list, unread count badges, "Signal Forming…" typing indicator, emoji strip,
  Transmitted / ViewSync receipts, ReSync message edits, delete own messages.
  Only conversation members can read messages; blocked users are cut off at the
  database level.
- **Dashboard** — asymmetric cyberfunk layout: left sidebar navigation,
  welcome hero, composer + feed, right rail with Online Now, Recent Activity
  and Transmissions (notifications).
- **Settings** — edit identity, app theme colours, reduce-motion mode,
  alert filters, default post visibility, block/unblock users, logout,
  delete account (typed-confirmation, wipes everything via cascade).

## SECURITY NOTES

- Every table has RLS enabled; no client can read another user's restricted data.
- `can_view_post()` re-checks visibility + blocks server-side for posts, likes,
  reactions and comments.
- Messages are readable only by members; blocked pairs can't message.
- Image uploads are validated (type/size) client-side *and* restricted by
  storage policies: users can only write into their own user-id folder.
- Deleted accounts cascade: profile → posts → comments → messages → everything.

## KNOWN V1 LIMITATIONS (deliberate, upgrade-ready)

- "Notifications" for likes/comments/etc. are written by the acting user's
  client; a Supabase Edge Function would make them tamper-proof in V2.
- Presence is `last_seen`-based (40s heartbeat), not socket presence.
- One-to-one chat only — group "Dimension Rooms" are planned for V3.
- Photo/GIF attachments are temporarily hidden in chat and the post composer;
  avatar uploads still work. The storage buckets and upload helper stay in the
  codebase so the option can be switched back on later.

## ROADMAP

- **V2.0** — Sticker Lab, advanced profile customization, more themes
- **V3.0** — Dimension Rooms (group chat), video sharing, shared galleries
- **V4.0** — interactive environments, custom soundscapes

*The architecture (contexts → lib/db.js → Supabase) is ready for all of it.*
