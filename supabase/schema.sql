-- ============================================================
--  SAS // SOCIAL AFTER SPACE — Supabase schema v1.5 (chat signals)
--  Run this whole file in: Supabase Dashboard -> SQL Editor -> New query
--  It creates every table, every Row Level Security policy,
--  triggers, storage buckets and realtime settings SAS needs.
--  Re-running it is safe (everything is guarded with IF NOT EXISTS
--  and drop-policy-if-exists).
--
--  v1.5 chat signals:
--   * conversation_members.last_read_at — powers unread badges and
--     ViewSync read receipts
--   * messages.edited_at — powers the ReSync label
--   * mark_conversation_read() + my_unread_counts() helpers
--   * message UPDATE policy for ReSync edits
--   * conversation_members added to the realtime publication
--
--  v1.1 audit fixes:
--   * friendships INSERT duplicate-check rewritten (name-collision bug)
--   * messages SELECT/INSERT block checks rewritten (name-collision bug)
--   * conversations DELETE "empty" check rewritten (name-collision bug)
--   * conversation_members INSERT: only conversation creators + members
--     adding accepted friends can join (no foreign joins)
--   * friendships UPDATE: only the addressee accepts; participants are
--     immutable (trigger) — prevents friendship forgery
--   * close_friends INSERT refuses blocked pairs
--   * image URLs restricted to their own storage buckets
--   * helper-function permissions hardened (authenticated-only)
--
--  v1.1.2 execution-order fix:
--   * all three chat tables (conversations, conversation_members,
--     messages) are now created BEFORE the helper functions and RLS
--     policies that reference them. `language sql` function bodies
--     are validated at creation time, so the old order aborted with
--     ERROR 42P01: relation "public.messages" does not exist.
--
--  v1.1.3 grants fix:
--   * new Supabase projects no longer auto-grant table privileges;
--     section 13 adds the GRANTs PostgREST/Realtime need (RLS still
--     decides which rows are visible).
-- ============================================================

create extension if not exists pgcrypto;

-- ============================================================
-- 1. PROFILES — digital identity cards
-- ============================================================
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null check (char_length(display_name) between 1 and 40),
  bio          text not null default '' check (char_length(bio) <= 280),
  status       text not null default '' check (char_length(status) <= 80),
  avatar_url   text check (avatar_url is null or avatar_url like '%/storage/v1/object/public/avatars/%'),
  accent       text not null default 'cyan' check (accent in ('cyan','purple','green','orange')),
  created_at   timestamptz not null default now(),
  last_seen    timestamptz not null default now()
);
create index if not exists profiles_username_idx on public.profiles (username);

alter table public.profiles enable row level security;

drop policy if exists "profiles readable by authenticated" on public.profiles;
create policy "profiles readable by authenticated"
  on public.profiles for select to authenticated using (true);

drop policy if exists "users insert own profile" on public.profiles;
create policy "users insert own profile"
  on public.profiles for insert to authenticated with check (auth.uid() = id);

drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile"
  on public.profiles for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

-- Auto-create a profile whenever someone signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  uname text;
  dname text;
begin
  -- idempotency guard: never loop if a profile already exists
  if exists (select 1 from public.profiles where id = new.id) then
    return new;
  end if;

  uname := lower(coalesce(new.raw_user_meta_data->>'username', split_part(new.email,'@',1)));
  uname := regexp_replace(uname, '[^a-z0-9_]', '', 'g');
  if uname is null or char_length(uname) < 3 then
    uname := 'runner_' || substr(replace(new.id::text,'-',''), 1, 8);
  end if;
  uname := substr(uname, 1, 20);
  dname := coalesce(nullif(new.raw_user_meta_data->>'display_name',''), uname);

  loop
    begin
      insert into public.profiles (id, username, display_name)
      values (new.id, uname, dname);
      exit;
    exception when unique_violation then
      uname := substr(uname, 1, 16) || floor(random()*9000 + 1000)::int::text;
    end;
  end loop;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- 2. BLOCKS — checked on the backend for every restricted read
-- ============================================================
create table if not exists public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
alter table public.blocks enable row level security;

drop policy if exists "read own blocks" on public.blocks;
create policy "read own blocks"
  on public.blocks for select to authenticated using (auth.uid() = blocker_id);

drop policy if exists "block anyone" on public.blocks;
create policy "block anyone"
  on public.blocks for insert to authenticated with check (auth.uid() = blocker_id);

drop policy if exists "unblock" on public.blocks;
create policy "unblock"
  on public.blocks for delete to authenticated using (auth.uid() = blocker_id);

-- Security-definer helpers (bypass RLS so policies cannot recurse).
-- auth.uid() inside these functions is still the calling user.
create or replace function public.has_block_with(other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.blocks b
    where (b.blocker_id = other and b.blocked_id = auth.uid())
       or (b.blocker_id = auth.uid() and b.blocked_id = other)
  );
$$;

-- ============================================================
-- 3. FRIENDSHIPS — requests + accepted friends
-- ============================================================
create table if not exists public.friendships (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending','accepted')),
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  check (requester_id <> addressee_id),
  unique (requester_id, addressee_id)
);
create index if not exists friendships_requester_idx on public.friendships (requester_id, status);
create index if not exists friendships_addressee_idx on public.friendships (addressee_id, status);

-- v1.1: duplicate-check helper (definer: sees all rows, immune to the
-- unqualified-column name collision the inline subquery had).
create or replace function public.has_friendship_between(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.friendships f
    where f.status in ('pending','accepted')
      and (
        (f.requester_id = a and f.addressee_id = b)
        or (f.requester_id = b and f.addressee_id = a)
      )
  );
$$;

alter table public.friendships enable row level security;

drop policy if exists "participants read friendships" on public.friendships;
create policy "participants read friendships"
  on public.friendships for select to authenticated
  using (auth.uid() in (requester_id, addressee_id));

drop policy if exists "send friend request" on public.friendships;
create policy "send friend request"
  on public.friendships for insert to authenticated with check (
    auth.uid() = requester_id
    and requester_id <> addressee_id
    and not public.has_block_with(addressee_id)
    and not public.has_friendship_between(auth.uid(), addressee_id)
  );

-- v1.1: ONLY the addressee can accept (no self-accepting), and the
-- participants are locked by the immutability trigger below, so a
-- malicious update cannot forge a friendship with an arbitrary victim.
drop policy if exists "accept friend request" on public.friendships;
create policy "accept friend request"
  on public.friendships for update to authenticated
  using (status = 'pending' and auth.uid() = addressee_id)
  with check (status = 'accepted' and auth.uid() = addressee_id);

drop policy if exists "remove friendship" on public.friendships;
create policy "remove friendship"
  on public.friendships for delete to authenticated
  using (auth.uid() in (requester_id, addressee_id));

-- v1.1: requester_id / addressee_id can never change after creation.
create or replace function public.protect_friendship_columns()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.requester_id is distinct from old.requester_id
     or new.addressee_id is distinct from old.addressee_id then
    raise exception 'SAS: friendship participants are immutable';
  end if;
  return new;
end $$;

drop trigger if exists friendships_protect_columns on public.friendships;
create trigger friendships_protect_columns
  before update on public.friendships
  for each row execute function public.protect_friendship_columns();

-- ============================================================
-- 4. CLOSE FRIENDS — the inner circle
-- ============================================================
create table if not exists public.close_friends (
  owner_id   uuid not null references public.profiles(id) on delete cascade,
  friend_id  uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, friend_id),
  check (owner_id <> friend_id)
);
create index if not exists close_friends_friend_idx on public.close_friends (friend_id);

alter table public.close_friends enable row level security;

drop policy if exists "read close friend links" on public.close_friends;
create policy "read close friend links"
  on public.close_friends for select to authenticated
  using (auth.uid() = owner_id or auth.uid() = friend_id);

-- v1.1: also refuses blocked pairs (defence in depth — can_view_post
-- already hides close posts from blocked users).
drop policy if exists "manage own close friends" on public.close_friends;
create policy "manage own close friends"
  on public.close_friends for insert to authenticated with check (
    auth.uid() = owner_id
    and not public.has_block_with(friend_id)
    and exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and (
          (f.requester_id = auth.uid() and f.addressee_id = friend_id)
          or (f.addressee_id = auth.uid() and f.requester_id = friend_id)
        )
    )
  );

drop policy if exists "remove own close friends" on public.close_friends;
create policy "remove own close friends"
  on public.close_friends for delete to authenticated using (auth.uid() = owner_id);

-- ============================================================
-- 5. POSTS — the SAS shared feed
-- ============================================================
create table if not exists public.posts (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid not null references public.profiles(id) on delete cascade,
  content    text not null default '' check (char_length(content) <= 2000),
  image_url  text check (image_url is null or image_url like '%/storage/v1/object/public/post-images/%'),
  visibility text not null default 'public' check (visibility in ('public','friends','close')),
  created_at timestamptz not null default now(),
  check (content <> '' or image_url is not null)
);
create index if not exists posts_created_idx on public.posts (created_at desc);
create index if not exists posts_author_idx on public.posts (author_id, created_at desc);

-- The single source of truth for who can see what.
-- SECURITY DEFINER: membership checks run with table-owner rights,
-- so blocked users can never read restricted posts from the client.
create or replace function public.can_view_post(p_author uuid, p_vis text)
returns boolean language sql stable security definer set search_path = public as $$
  select
    p_author = auth.uid()
    or (
      p_vis = 'public'
      and not public.has_block_with(p_author)
    )
    or (
      p_vis = 'friends'
      and not public.has_block_with(p_author)
      and exists (
        select 1 from public.friendships f
        where f.status = 'accepted'
          and (
            (f.requester_id = p_author and f.addressee_id = auth.uid())
            or (f.addressee_id = p_author and f.requester_id = auth.uid())
          )
      )
    )
    or (
      p_vis = 'close'
      and not public.has_block_with(p_author)
      and exists (
        select 1 from public.close_friends cf
        where cf.owner_id = p_author and cf.friend_id = auth.uid()
      )
    );
$$;

alter table public.posts enable row level security;

drop policy if exists "posts visible per rules" on public.posts;
create policy "posts visible per rules"
  on public.posts for select to authenticated
  using (public.can_view_post(author_id, visibility));

drop policy if exists "authors create posts" on public.posts;
create policy "authors create posts"
  on public.posts for insert to authenticated with check (auth.uid() = author_id);

drop policy if exists "authors update posts" on public.posts;
create policy "authors update posts"
  on public.posts for update to authenticated
  using (auth.uid() = author_id) with check (auth.uid() = author_id);

drop policy if exists "authors delete posts" on public.posts;
create policy "authors delete posts"
  on public.posts for delete to authenticated using (auth.uid() = author_id);

-- ============================================================
-- 6. LIKES / REACTIONS / COMMENTS
-- ============================================================
create table if not exists public.likes (
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index if not exists likes_user_idx on public.likes (user_id);

alter table public.likes enable row level security;

drop policy if exists "likes visible with post" on public.likes;
create policy "likes visible with post"
  on public.likes for select to authenticated
  using (exists (
    select 1 from public.posts p
    where p.id = post_id and public.can_view_post(p.author_id, p.visibility)
  ));

drop policy if exists "like visible posts" on public.likes;
create policy "like visible posts"
  on public.likes for insert to authenticated with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.posts p
      where p.id = post_id and public.can_view_post(p.author_id, p.visibility)
    )
  );

drop policy if exists "unlike" on public.likes;
create policy "unlike"
  on public.likes for delete to authenticated using (auth.uid() = user_id);

create table if not exists public.reactions (
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  emoji      text not null check (char_length(emoji) between 1 and 8),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id, emoji)
);
create index if not exists reactions_user_idx on public.reactions (user_id);

alter table public.reactions enable row level security;

drop policy if exists "reactions visible with post" on public.reactions;
create policy "reactions visible with post"
  on public.reactions for select to authenticated
  using (exists (
    select 1 from public.posts p
    where p.id = post_id and public.can_view_post(p.author_id, p.visibility)
  ));

drop policy if exists "react to visible posts" on public.reactions;
create policy "react to visible posts"
  on public.reactions for insert to authenticated with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.posts p
      where p.id = post_id and public.can_view_post(p.author_id, p.visibility)
    )
  );

drop policy if exists "remove reaction" on public.reactions;
create policy "remove reaction"
  on public.reactions for delete to authenticated using (auth.uid() = user_id);

create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts(id) on delete cascade,
  author_id  uuid not null references public.profiles(id) on delete cascade,
  content    text not null check (char_length(content) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists comments_post_idx on public.comments (post_id, created_at);

alter table public.comments enable row level security;

drop policy if exists "comments visible with post" on public.comments;
create policy "comments visible with post"
  on public.comments for select to authenticated
  using (exists (
    select 1 from public.posts p
    where p.id = post_id and public.can_view_post(p.author_id, p.visibility)
  ));

drop policy if exists "comment on visible posts" on public.comments;
create policy "comment on visible posts"
  on public.comments for insert to authenticated with check (
    auth.uid() = author_id
    and exists (
      select 1 from public.posts p
      where p.id = post_id and public.can_view_post(p.author_id, p.visibility)
    )
  );

drop policy if exists "delete own comments" on public.comments;
create policy "delete own comments"
  on public.comments for delete to authenticated using (auth.uid() = author_id);

-- ============================================================
-- 7. NOTIFICATIONS
-- ============================================================
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  actor_id   uuid not null references public.profiles(id) on delete cascade,
  type       text not null check (type in ('friend_request','friend_accepted','post_like','post_comment','post_reaction')),
  post_id    uuid references public.posts(id) on delete cascade,
  read       boolean not null default false,
  created_at timestamptz not null default now(),
  check (user_id <> actor_id)
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "read own notifications" on public.notifications;
create policy "read own notifications"
  on public.notifications for select to authenticated using (auth.uid() = user_id);

-- V1 trade-off: created by the acting user's client. A Supabase Edge
-- Function is the V2 tamper-proof replacement.
drop policy if exists "create notifications" on public.notifications;
create policy "create notifications"
  on public.notifications for insert to authenticated with check (auth.uid() = actor_id);

drop policy if exists "update own notifications" on public.notifications;
create policy "update own notifications"
  on public.notifications for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "delete own notifications" on public.notifications;
create policy "delete own notifications"
  on public.notifications for delete to authenticated using (auth.uid() = user_id);

-- ============================================================
-- 8. CHAT — conversations, members, messages
-- v1.1.2: the three tables are created FIRST, then the helper
-- functions, then the policies. `language sql` function bodies are
-- validated at creation time, so a helper referencing a table that
-- does not exist yet aborts the whole script (ERROR 42P01,
-- relation "public.messages" does not exist).
-- ============================================================
create table if not exists public.conversations (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  last_message_at timestamptz
);

alter table public.conversations enable row level security;

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  joined_at       timestamptz not null default now(),
  last_read_at    timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
-- v1.5 upgrade path for projects created before read receipts existed
alter table public.conversation_members
  add column if not exists last_read_at timestamptz not null default now();
create index if not exists conversation_members_user_idx on public.conversation_members (user_id);

alter table public.conversation_members enable row level security;

create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id       uuid not null references public.profiles(id) on delete cascade,
  content         text not null default '' check (char_length(content) <= 2000),
  image_url       text check (image_url is null or image_url like '%/storage/v1/object/public/chat-images/%'),
  created_at      timestamptz not null default now(),
  edited_at       timestamptz,
  check (content <> '' or image_url is not null)
);
-- v1.5 upgrade path for projects created before ReSync existed
alter table public.messages add column if not exists edited_at timestamptz;
create index if not exists messages_conv_idx on public.messages (conversation_id, created_at desc);

alter table public.messages enable row level security;

-- ---- Helper functions (every table they read now exists) ----

-- Helper: is the caller a member of this conversation?
create or replace function public.is_conv_member(p_conv uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.conversation_members m
    where m.conversation_id = p_conv and m.user_id = auth.uid()
  );
$$;

-- v1.1: does this conversation contain messages? (definer so the check
-- cannot be blinded by the caller's own RLS — fixes the deleted-policy
-- collision that let members wipe non-empty conversations)
create or replace function public.conv_is_empty(p_conv uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from public.messages m where m.conversation_id = p_conv
  );
$$;

-- v1.1: block check rewritten as a definer helper scoped to THIS
-- conversation (the old inline subquery collided on conversation_id and
-- checked the wrong rows entirely).
create or replace function public.conv_has_block_with(p_conv uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = p_conv
      and cm.user_id <> auth.uid()
      and public.has_block_with(cm.user_id)
  );
$$;

-- v1.1: membership authorization fully server-side. You may only:
--   (a) join your OWN brand-new conversation (0 members, or only you), or
--   (b) as an existing member, add an ACCEPTED FRIEND with no blocks.
-- Nobody can join a conversation they were not invited to by these rules.
create or replace function public.can_join_conversation(p_conv uuid, p_user uuid)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare
  member_count bigint;
  i_am_member  boolean;
begin
  select count(*) into member_count
    from public.conversation_members m
    where m.conversation_id = p_conv;

  select exists (
    select 1 from public.conversation_members m
    where m.conversation_id = p_conv and m.user_id = auth.uid()
  ) into i_am_member;

  -- (a) creator joining a fresh conversation
  if p_user = auth.uid()
     and (member_count = 0 or (member_count = 1 and i_am_member)) then
    return true;
  end if;

  -- (b) member adding an accepted friend
  if i_am_member and p_user <> auth.uid() then
    return not public.has_block_with(p_user)
      and exists (
        select 1 from public.friendships f
        where f.status = 'accepted'
          and (
            (f.requester_id = auth.uid() and f.addressee_id = p_user)
            or (f.addressee_id = auth.uid() and f.requester_id = p_user)
          )
      );
  end if;

  return false;
end $$;

-- ---- RLS policies ----

drop policy if exists "members read conversations" on public.conversations;
create policy "members read conversations"
  on public.conversations for select to authenticated
  using (public.is_conv_member(id));

drop policy if exists "members create conversations" on public.conversations;
create policy "members create conversations"
  on public.conversations for insert to authenticated with check (true);

drop policy if exists "cleanup empty conversations" on public.conversations;
create policy "cleanup empty conversations"
  on public.conversations for delete to authenticated
  using (public.is_conv_member(id) and public.conv_is_empty(id));

drop policy if exists "members read members" on public.conversation_members;
create policy "members read members"
  on public.conversation_members for select to authenticated
  using (user_id = auth.uid() or public.is_conv_member(conversation_id));

drop policy if exists "join own membership" on public.conversation_members;
create policy "join own membership"
  on public.conversation_members for insert to authenticated
  with check (public.can_join_conversation(conversation_id, user_id));

drop policy if exists "members read messages" on public.messages;
create policy "members read messages"
  on public.messages for select to authenticated
  using (
    public.is_conv_member(conversation_id)
    and not public.conv_has_block_with(conversation_id)
  );

drop policy if exists "members send messages" on public.messages;
create policy "members send messages"
  on public.messages for insert to authenticated with check (
    sender_id = auth.uid()
    and public.is_conv_member(conversation_id)
    and not public.conv_has_block_with(conversation_id)
  );

drop policy if exists "delete own messages" on public.messages;
create policy "delete own messages"
  on public.messages for delete to authenticated
  using (sender_id = auth.uid());

drop policy if exists "edit own messages" on public.messages;
create policy "edit own messages"
  on public.messages for update to authenticated
  using (
    sender_id = auth.uid()
    and public.is_conv_member(conversation_id)
  )
  with check (
    sender_id = auth.uid()
    and public.is_conv_member(conversation_id)
    and not public.conv_has_block_with(conversation_id)
    and (content <> '' or image_url is not null)
  );

-- v1.5: mark a conversation read (updates only the caller's own row)
create or replace function public.mark_conversation_read(conv uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_conv_member(conv) then
    raise exception 'Not a member of this conversation';
  end if;
  update public.conversation_members
     set last_read_at = now()
   where conversation_id = conv and user_id = auth.uid();
end $$;

revoke all on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- v1.5: unread counts for the sidebar badge + conversation list
create or replace function public.my_unread_counts()
returns table (conversation_id uuid, unread bigint)
language sql
stable
security definer
set search_path = public
as $$
  select m.conversation_id, count(*)::bigint as unread
  from public.messages m
  join public.conversation_members cm
    on cm.conversation_id = m.conversation_id
   and cm.user_id = auth.uid()
  where m.sender_id <> auth.uid()
    and m.created_at > coalesce(cm.last_read_at, 'epoch'::timestamptz)
  group by m.conversation_id;
$$;

revoke all on function public.my_unread_counts() from public, anon;
grant execute on function public.my_unread_counts() to authenticated;

-- ---- Trigger: keep conversation last_message_at fresh ----

create or replace function public.touch_conversation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  return new;
end $$;

drop trigger if exists messages_touch_conversation on public.messages;
create trigger messages_touch_conversation
  after insert on public.messages
  for each row execute function public.touch_conversation();

-- ============================================================
-- 9. FUNCTION PERMISSIONS — helpers run inside RLS policies as the
-- calling user, so they must be executable by authenticated only.
-- ============================================================
revoke all on function public.has_block_with(uuid) from public, anon;
grant execute on function public.has_block_with(uuid) to authenticated;

revoke all on function public.has_friendship_between(uuid, uuid) from public, anon;
grant execute on function public.has_friendship_between(uuid, uuid) to authenticated;

revoke all on function public.can_view_post(uuid, text) from public, anon;
grant execute on function public.can_view_post(uuid, text) to authenticated;

revoke all on function public.is_conv_member(uuid) from public, anon;
grant execute on function public.is_conv_member(uuid) to authenticated;

revoke all on function public.conv_is_empty(uuid) from public, anon;
grant execute on function public.conv_is_empty(uuid) to authenticated;

revoke all on function public.conv_has_block_with(uuid) from public, anon;
grant execute on function public.conv_has_block_with(uuid) to authenticated;

revoke all on function public.can_join_conversation(uuid, uuid) from public, anon;
grant execute on function public.can_join_conversation(uuid, uuid) to authenticated;

-- ============================================================
-- 10. ACCOUNT DELETION — wipes the auth user + all data (cascade)
-- v1.1.1: the function is defined FIRST; permissions AFTER creation.
-- ============================================================
create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  delete from auth.users
  where id = auth.uid();
end;
$$;

-- Permissions must be configured AFTER function creation.
revoke all on function public.delete_account()
from public, anon;

grant execute on function public.delete_account()
to authenticated;

-- ============================================================
-- 11. STORAGE — avatars, post images, chat images
-- NOTE: buckets are public-read by design (the frontend renders images
-- via getPublicUrl). Anyone holding the exact URL — an unguessable
-- uuid/timestamp path — can fetch that image. Uploads are locked to
-- the owner's user-id folder.
-- ============================================================
insert into storage.buckets (id, name, public)
values ('avatars','avatars',true), ('post-images','post-images',true), ('chat-images','chat-images',true)
on conflict (id) do nothing;

update storage.buckets
set file_size_limit = 8388608,
    allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif']
where id in ('avatars','post-images','chat-images');

drop policy if exists "media readable" on storage.objects;
create policy "media readable"
  on storage.objects for select to authenticated
  using (bucket_id in ('avatars','post-images','chat-images'));

drop policy if exists "upload to own folder" on storage.objects;
create policy "upload to own folder"
  on storage.objects for insert to authenticated with check (
    bucket_id in ('avatars','post-images','chat-images')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "update own uploads" on storage.objects;
create policy "update own uploads"
  on storage.objects for update to authenticated
  using (
    bucket_id in ('avatars','post-images','chat-images')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "delete own uploads" on storage.objects;
create policy "delete own uploads"
  on storage.objects for delete to authenticated
  using (
    bucket_id in ('avatars','post-images','chat-images')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================
-- 12. REALTIME — live chat + live notifications
-- Realtime applies each table's SELECT policies per subscriber, so
-- members-only chat stays private over the wire.
-- ============================================================
-- DELETE events must carry the full old row so Realtime can apply RLS
-- and actually deliver deletes to both chat members.
alter table public.messages replica identity full;

do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when others then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.conversation_members;
exception when others then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when others then null; end $$;

-- ============================================================
-- 13. TABLE PERMISSIONS — required on new Supabase projects
-- New projects no longer auto-grant table privileges when tables are
-- created via the SQL editor. RLS filters ROWS; these grants are the
-- DOOR KEY. Without them PostgREST/Realtime fail with 42501
-- "permission denied for table ..." even for logged-in users.
-- (No blanket function grants here — client-callable functions get
-- their explicit authenticated-only grants in sections 9 and 10.)
-- ============================================================
grant usage on schema public to anon, authenticated;

grant select, insert, update, delete
  on all tables in schema public
  to anon, authenticated;

alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated;

-- ============================================================
-- 14. ATOMIC CONVERSATION CREATION (v1.4)
-- One server-side transaction: validates friendship + blocks,
-- reuses an existing 1-on-1 chat, else creates conversation and
-- both memberships. Removes the multi-step client flow that could
-- fail mid-way on RLS. Client calls: rpc('start_conversation',
-- { other: <uuid> }).
-- ============================================================
create or replace function public.start_conversation(other uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me   uuid := auth.uid();
  conv uuid;
begin
  if me is null then
    raise exception 'Not signed in';
  end if;
  if other = me then
    raise exception 'You cannot message yourself';
  end if;
  if public.has_block_with(other) then
    raise exception 'You cannot message this user';
  end if;
  if not exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and (
        (f.requester_id = me and f.addressee_id = other)
        or (f.addressee_id = me and f.requester_id = other)
      )
  ) then
    raise exception 'You are not friends with this user';
  end if;

  select cm1.conversation_id into conv
  from public.conversation_members cm1
  join public.conversation_members cm2 on cm2.conversation_id = cm1.conversation_id
  where cm1.user_id = me and cm2.user_id = other
  limit 1;

  if conv is not null then
    return conv;
  end if;

  insert into public.conversations default values returning id into conv;
  insert into public.conversation_members (conversation_id, user_id)
    values (conv, me), (conv, other);

  return conv;
end $$;

revoke all on function public.start_conversation(uuid) from public, anon;
grant execute on function public.start_conversation(uuid) to authenticated;

-- ============================================================
--  SAS v1.5 schema complete.
-- ============================================================
