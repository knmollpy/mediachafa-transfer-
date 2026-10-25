-- Allow PS4 catalog entries to carry multiple folder labels while keeping the
-- legacy folder_id column available for older clients and policies.
create table if not exists public.ps4_game_folder_assignments (
  game_id uuid not null references public.ps4_games(id) on delete cascade,
  folder_id uuid not null references public.ps4_game_folders(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (game_id, folder_id)
);

create index if not exists ps4_game_folder_assignments_folder_idx
  on public.ps4_game_folder_assignments(folder_id, game_id);

alter table public.ps4_game_folder_assignments enable row level security;
grant select on public.ps4_game_folder_assignments to anon, authenticated;
grant insert, delete on public.ps4_game_folder_assignments to authenticated;
grant all on public.ps4_game_folder_assignments to service_role;

drop policy if exists "PS4 folder assignments visible with game and folder" on public.ps4_game_folder_assignments;
create policy "PS4 folder assignments visible with game and folder"
on public.ps4_game_folder_assignments for select to anon, authenticated
using (
  exists (select 1 from public.ps4_games g where g.id = game_id)
  and exists (select 1 from public.ps4_game_folders f where f.id = folder_id)
);

drop policy if exists "Owner and collaborators assign PS4 game folders" on public.ps4_game_folder_assignments;
create policy "Owner and collaborators assign PS4 game folders"
on public.ps4_game_folder_assignments for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (
    (select auth.uid()) = '3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid
    or exists (
      select 1 from public.media_users u
      where u.id = (select auth.uid()) and u.role = 'collaborator'
    )
  )
  and exists (
    select 1 from public.ps4_games g where g.id = game_id
      and (g.created_by = (select auth.uid()) or (select auth.uid()) = '3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid)
  )
  and exists (select 1 from public.ps4_game_folders f where f.id = folder_id)
);

drop policy if exists "Owner and collaborators remove PS4 game folders" on public.ps4_game_folder_assignments;
create policy "Owner and collaborators remove PS4 game folders"
on public.ps4_game_folder_assignments for delete to authenticated
using (
  (select auth.uid()) = '3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid
  or (
    created_by = (select auth.uid())
    and exists (
      select 1 from public.media_users u
      where u.id = (select auth.uid()) and u.role = 'collaborator'
    )
  )
);

-- Preserve every game's existing single-folder placement during migration.
insert into public.ps4_game_folder_assignments (game_id, folder_id, created_by)
select id, folder_id, created_by
from public.ps4_games
where folder_id is not null
on conflict (game_id, folder_id) do nothing;

