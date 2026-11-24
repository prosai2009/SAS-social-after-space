-- ============================================================
-- SAS v1.5 — chat signals upgrade
-- Run this ONCE in Supabase -> SQL Editor on the existing project.
-- Safe to re-run.
-- Adds: unread counts, ViewSync read receipts, ReSync message edits,
--       and realtime updates for conversation read state.
-- ============================================================

alter table public.conversation_members
  add column if not exists last_read_at timestamptz not null default now();

alter table public.messages
  add column if not exists edited_at timestamptz;

-- Senders may update their own messages (ReSync) — only inside channels
-- they still belong to, and never into a blocked conversation.
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

-- Mark one conversation as read for the signed-in user.
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

-- Unread message counts per conversation for the signed-in user.
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

-- Let live messages and deletes through, and make DELETE events carry the
-- full old row so Realtime can apply RLS and deliver them to both members.
alter table public.messages replica identity full;

do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when others then null; end $$;

-- Let the sender see the other member's last_read_at update live.
do $$ begin
  alter publication supabase_realtime add table public.conversation_members;
exception when others then null; end $$;

-- Ask the API layer to pick up the two new functions immediately.
notify pgrst, 'reload schema';

-- Diagnostics: both counts should be 0 or more; no error means success.
select 'conversation members' as what, count(*) as rows from public.conversation_members
union all
select 'messages', count(*) from public.messages;

-- Realtime diagnostic: these two tables must be listed.
select tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
order by tablename;
