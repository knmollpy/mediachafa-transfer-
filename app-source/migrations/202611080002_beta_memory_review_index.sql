-- MediaChafa Beta: index the existing owner-confirmed persistent memory.
-- The table already enforces owner-only RLS and rejects sensitive=true; reuse it instead of duplicating memory.
create index if not exists task_hunter_memory_reusable_context_idx
  on public.task_hunter_memory (user_id, updated_at desc)
  where user_confirmed = true and reusable = true and sensitive = false;

comment on table public.task_hunter_memory is
  'Owner-confirmed, reusable, non-sensitive long-term memory shared by MediaChafa Beta and Task Hunter.';
