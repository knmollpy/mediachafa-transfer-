-- AI Task Hunter: durable job, opportunity, event and user-confirmed memory foundation.
-- All records are private to the authenticated owner. Sensitive personal answers are excluded.
create table if not exists public.task_hunter_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 180),
  description text not null default '' check (char_length(description) <= 12000),
  source_platform text,
  source_url text,
  task_category text not null default 'other',
  assigned_model text not null default 'mediachafa-pro',
  status text not null default 'queued' check (status in ('draft','queued','running','waiting','paused','completed','submitted','accepted','rejected','failed','cancelled')),
  stage text not null default 'queued',
  estimated_reward numeric(12,2),
  estimated_currency text not null default 'USD' check (estimated_currency ~ '^[A-Z]{3}$'),
  actual_reward numeric(12,2),
  actual_currency text check (actual_currency is null or actual_currency ~ '^[A-Z]{3}$'),
  payout_status text not null default 'unconfirmed' check (payout_status in ('unconfirmed','pending','approved','paid','rejected','not_applicable')),
  payout_reference text,
  estimated_duration_seconds integer check (estimated_duration_seconds is null or estimated_duration_seconds >= 0),
  active_seconds bigint not null default 0 check (active_seconds >= 0),
  elapsed_seconds bigint not null default 0 check (elapsed_seconds >= 0),
  started_at timestamptz,
  finished_at timestamptz,
  last_checkpoint_at timestamptz,
  checkpoint jsonb not null default '{}'::jsonb,
  result_summary text,
  result_data jsonb not null default '{}'::jsonb,
  quality_checks jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists task_hunter_jobs_user_status_idx on public.task_hunter_jobs(user_id,status,updated_at desc);
create index if not exists task_hunter_jobs_user_created_idx on public.task_hunter_jobs(user_id,created_at desc);
alter table public.task_hunter_jobs enable row level security;
drop policy if exists "Users manage own task hunter jobs" on public.task_hunter_jobs;
create policy "Users manage own task hunter jobs" on public.task_hunter_jobs for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.task_hunter_jobs to authenticated;

create table if not exists public.task_hunter_events (
 id uuid primary key default gen_random_uuid(),
 job_id uuid not null references public.task_hunter_jobs(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 event_type text not null check (char_length(event_type) between 1 and 80),
 stage text,
 message text not null default '' check (char_length(message) <= 3000),
 details jsonb not null default '{}'::jsonb,
 active_seconds_delta integer not null default 0 check (active_seconds_delta >= 0),
 created_at timestamptz not null default now()
);
create index if not exists task_hunter_events_job_created_idx on public.task_hunter_events(job_id,created_at);
alter table public.task_hunter_events enable row level security;
drop policy if exists "Users manage own task hunter events" on public.task_hunter_events;
create policy "Users manage own task hunter events" on public.task_hunter_events for all to authenticated
using ((select auth.uid()) = user_id and exists (select 1 from public.task_hunter_jobs j where j.id=job_id and j.user_id=(select auth.uid())))
with check ((select auth.uid()) = user_id and exists (select 1 from public.task_hunter_jobs j where j.id=job_id and j.user_id=(select auth.uid())));
grant select, insert, update, delete on public.task_hunter_events to authenticated;

create table if not exists public.task_hunter_opportunities (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 platform text not null,
 external_id text,
 title text not null check (char_length(btrim(title)) between 1 and 180),
 description text not null default '' check (char_length(description) <= 12000),
 category text not null default 'other',
 url text,
 estimated_reward numeric(12,2),
 currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
 estimated_duration_seconds integer check (estimated_duration_seconds is null or estimated_duration_seconds >= 0),
 eligibility_status text not null default 'unverified' check (eligibility_status in ('unverified','eligible','ineligible','manual_check')),
 automation_status text not null default 'unverified' check (automation_status in ('unverified','allowed','assisted_only','prohibited')),
 status text not null default 'new' check (status in ('new','saved','assigned','dismissed','expired')),
 source_data jsonb not null default '{}'::jsonb,
 discovered_at timestamptz not null default now(),
 expires_at timestamptz,
 unique(user_id,platform,external_id)
);
create index if not exists task_hunter_opportunities_user_status_idx on public.task_hunter_opportunities(user_id,status,discovered_at desc);
alter table public.task_hunter_opportunities enable row level security;
drop policy if exists "Users manage own task hunter opportunities" on public.task_hunter_opportunities;
create policy "Users manage own task hunter opportunities" on public.task_hunter_opportunities for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.task_hunter_opportunities to authenticated;

create table if not exists public.task_hunter_memory (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 memory_key text not null check (char_length(btrim(memory_key)) between 1 and 120),
 memory_value jsonb not null,
 user_confirmed boolean not null default false,
 reusable boolean not null default false,
 sensitive boolean not null default false check (sensitive = false),
 source text not null default 'user_confirmed',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(user_id,memory_key)
);
create index if not exists task_hunter_memory_user_idx on public.task_hunter_memory(user_id);
alter table public.task_hunter_memory enable row level security;
drop policy if exists "Users manage own task hunter memory" on public.task_hunter_memory;
create policy "Users manage own task hunter memory" on public.task_hunter_memory for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id and sensitive = false);
grant select, insert, update, delete on public.task_hunter_memory to authenticated;
