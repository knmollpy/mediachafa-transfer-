-- Public PS4 catalog reports and configurable member accounts.
alter table public.media_users
  add column if not exists can_view_public_files boolean not null default true,
  add column if not exists can_view_links boolean not null default true,
  add column if not exists can_create_folders boolean not null default false,
  add column if not exists storage_limit_bytes bigint not null default 0;

alter table public.media_users drop constraint if exists media_users_role_check;
update public.media_users set role='collaborator' where role='uploader';
alter table public.media_users add constraint media_users_role_check check (role in ('collaborator','member'));
alter table public.media_users alter column role set default 'collaborator';

-- Anonymous users can read the public PS4 catalog but cannot enumerate the general file library.
drop policy if exists "Files visible by privacy" on public.media_files;
create policy "Files visible to authorized accounts" on public.media_files
for select to authenticated using (
  auth.uid() = '3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid
  or exists (select 1 from public.media_users u where u.id=auth.uid() and u.role='collaborator')
  or exists (select 1 from public.media_users u where u.id=auth.uid() and u.role='member' and
    ( (not is_private and u.can_view_public_files) or auth.uid()=created_by or auth.uid()=any(coalesce(allowed_user_ids,'{}'::uuid[])) ))
);

drop policy if exists "Folders visible by privacy" on public.media_folders;
create policy "Folders visible to authorized accounts" on public.media_folders
for select to authenticated using (
  auth.uid() = '3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid
  or exists (select 1 from public.media_users u where u.id=auth.uid() and u.role='collaborator')
  or exists (select 1 from public.media_users u where u.id=auth.uid() and u.role='member' and
    ( (not is_private and u.can_view_public_files) or auth.uid()=created_by or auth.uid()=any(coalesce(allowed_user_ids,'{}'::uuid[])) ))
);

-- Members only see public links when the owner grants that capability; collaborators keep full access.
drop policy if exists "Public links and own private links are readable" on public.media_links;
create policy "Authorized accounts can read links" on public.media_links
for select to authenticated using (
  auth.uid() = '3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid
  or exists (select 1 from public.media_users u where u.id=auth.uid() and u.role='collaborator')
  or exists (select 1 from public.media_users u where u.id=auth.uid() and u.role='member' and u.can_view_links and (not is_private or created_by=auth.uid()))
);

-- A member can create folders only when explicitly allowed by the owner.
drop policy if exists "Uploader accounts can add folders" on public.media_folders;
create policy "Authorized accounts can add folders" on public.media_folders
for insert to authenticated with check (
  created_by=auth.uid() and (
    auth.uid()='3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid
    or exists (select 1 from public.media_users u where u.id=auth.uid() and (u.role='collaborator' or (u.role='member' and u.can_create_folders)))
  )
);

create table if not exists public.ps4_game_reports (
  id uuid primary key default gen_random_uuid(),
  game_title text not null check (char_length(btrim(game_title)) between 1 and 160),
  details text not null default '' check (char_length(details) <= 1000),
  submitted_by uuid references auth.users(id) on delete set null,
  status text not null default 'open' check (status in ('open','resolved')),
  created_at timestamptz not null default now()
);
create index if not exists ps4_game_reports_created_at_idx on public.ps4_game_reports(created_at desc);
alter table public.ps4_game_reports enable row level security;
grant select, insert, update, delete on public.ps4_game_reports to anon, authenticated;
drop policy if exists "Anyone can report a PS4 game link" on public.ps4_game_reports;
create policy "Anyone can report a PS4 game link" on public.ps4_game_reports
for insert to anon, authenticated with check (submitted_by is null or submitted_by=auth.uid());
drop policy if exists "Only owner can read game reports" on public.ps4_game_reports;
create policy "Only owner can read game reports" on public.ps4_game_reports
for select to authenticated using (auth.uid()='3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid);
drop policy if exists "Only owner can update game reports" on public.ps4_game_reports;
create policy "Only owner can update game reports" on public.ps4_game_reports
for update to authenticated using (auth.uid()='3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid) with check (auth.uid()='3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid);
drop policy if exists "Only owner can delete game reports" on public.ps4_game_reports;
create policy "Only owner can delete game reports" on public.ps4_game_reports
for delete to authenticated using (auth.uid()='3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid);

-- Realtime updates allow the owner's DM inbox to refresh immediately.
do $$ begin
  alter publication supabase_realtime add table public.ps4_game_reports;
exception when duplicate_object then null; when undefined_object then null; end $$;
