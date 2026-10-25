create table if not exists public.ps4_game_folders (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_private boolean not null default false,
  allowed_user_ids uuid[] not null default '{}',
  constraint ps4_game_folders_owner_name_key unique (created_by, name)
);

create table if not exists public.ps4_games (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  download_url text not null check (
    char_length(download_url) between 8 and 2048
    and download_url ~* '^https?://'
  ),
  cover_image text check (
    cover_image is null
    or (cover_image ~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$' and octet_length(cover_image) <= 500000)
  ),
  description text not null default '' check (char_length(description) <= 2000),
  features text not null default '' check (char_length(features) <= 5000),
  folder_id uuid references public.ps4_game_folders(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_private boolean not null default false,
  allowed_user_ids uuid[] not null default '{}'
);

create index if not exists ps4_games_folder_id_idx on public.ps4_games(folder_id);
create index if not exists ps4_games_created_at_idx on public.ps4_games(created_at desc);

alter table public.ps4_game_folders enable row level security;
alter table public.ps4_games enable row level security;

grant select on public.ps4_game_folders, public.ps4_games to anon;
grant select, insert, update, delete on public.ps4_game_folders, public.ps4_games to authenticated;
grant select, insert, update, delete on public.ps4_game_folders, public.ps4_games to service_role;

create policy "PS4 game folders visible by privacy"
on public.ps4_game_folders for select to anon, authenticated
using (
  not is_private
  or (select auth.uid()) = '3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid
  or created_by = (select auth.uid())
  or coalesce((select auth.uid()) = any(allowed_user_ids), false)
);

create policy "Owner and uploaders can create PS4 game folders"
on public.ps4_game_folders for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (
    (select auth.uid()) = '3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid
    or exists (
      select 1 from public.media_users u
      where u.id = (select auth.uid()) and u.can_upload
    )
  )
);

create policy "Owners and authors can update PS4 game folders"
on public.ps4_game_folders for update to authenticated
using (
  (select auth.uid()) = '3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid
  or (created_by = (select auth.uid()) and exists (
    select 1 from public.media_users u where u.id = (select auth.uid()) and u.can_upload
  ))
)
with check (
  (select auth.uid()) = '3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid
  or (created_by = (select auth.uid()) and exists (
    select 1 from public.media_users u where u.id = (select auth.uid()) and u.can_upload
  ))
);

create policy "Owners and authors can delete PS4 game folders"
on public.ps4_game_folders for delete to authenticated
using (
  (select auth.uid()) = '3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid
  or (created_by = (select auth.uid()) and exists (
    select 1 from public.media_users u where u.id = (select auth.uid()) and u.can_upload
  ))
);

create policy "PS4 games visible by privacy"
on public.ps4_games for select to anon, authenticated
using (
  (
    not is_private
    and (
      folder_id is null
      or exists (
        select 1 from public.ps4_game_folders f
        where f.id = folder_id and not f.is_private
      )
    )
  )
  or (select auth.uid()) = '3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid
  or created_by = (select auth.uid())
  or coalesce((select auth.uid()) = any(allowed_user_ids), false)
  or exists (
    select 1 from public.ps4_game_folders f
    where f.id = folder_id
      and (
        (select auth.uid()) = '3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid
        or f.created_by = (select auth.uid())
        or coalesce((select auth.uid()) = any(f.allowed_user_ids), false)
      )
  )
);

create policy "Owner and uploaders can add PS4 games"
on public.ps4_games for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (
    (select auth.uid()) = '3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid
    or exists (
      select 1 from public.media_users u
      where u.id = (select auth.uid()) and u.can_upload
    )
  )
);

create policy "Owners and authors can update PS4 games"
on public.ps4_games for update to authenticated
using (
  (select auth.uid()) = '3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid
  or (created_by = (select auth.uid()) and exists (
    select 1 from public.media_users u where u.id = (select auth.uid()) and u.can_upload
  ))
)
with check (
  (select auth.uid()) = '3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid
  or (created_by = (select auth.uid()) and exists (
    select 1 from public.media_users u where u.id = (select auth.uid()) and u.can_upload
  ))
);

create policy "Owners and authors can delete PS4 games"
on public.ps4_games for delete to authenticated
using (
  (select auth.uid()) = '3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid
  or (created_by = (select auth.uid()) and exists (
    select 1 from public.media_users u where u.id = (select auth.uid()) and u.can_upload
  ))
);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ps4_game_folders'
    ) then
      alter publication supabase_realtime add table public.ps4_game_folders;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ps4_games'
    ) then
      alter publication supabase_realtime add table public.ps4_games;
    end if;
  end if;
end $$;
