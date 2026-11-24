-- ============================================================
-- SAS — live chat Realtime fix
-- Run this ONCE in Supabase -> SQL Editor.
-- Safe to re-run. It only touches Realtime wiring.
-- ============================================================

-- DELETE events carry the full old row, so Realtime can apply the
-- members-only SELECT policy and deliver deletes to both people.
alter table public.messages replica identity full;

-- Make sure both chat tables are actually broadcast.
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; when others then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.conversation_members;
exception when duplicate_object then null; when others then null; end $$;

-- Diagnostics -------------------------------------------------
-- messages must show relreplident = 'f' (full).
select c.relname as table_name, c.relreplident
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'messages';

-- messages and conversation_members must appear in this list.
select tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
order by tablename;
