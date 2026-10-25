alter table public.media_users add column if not exists can_view_ps4_games boolean not null default true;

-- The catalog remains public for guest mode; signed-in members only see it when allowed.
drop policy if exists "PS4 game folders visible by privacy" on public.ps4_game_folders;
create policy "PS4 game folders visible by privacy" on public.ps4_game_folders for select to anon, authenticated using (
  (not is_private and ((select auth.uid()) is null or (select auth.uid())='3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid or exists(select 1 from public.media_users u where u.id=(select auth.uid()) and (u.role='collaborator' or (u.role='member' and u.can_view_ps4_games)))))
  or (select auth.uid())='3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid
  or created_by=(select auth.uid())
  or coalesce((select auth.uid())=any(allowed_user_ids),false)
);
drop policy if exists "PS4 games visible by privacy" on public.ps4_games;
create policy "PS4 games visible by privacy" on public.ps4_games for select to anon, authenticated using (
  ((not is_private) and ((folder_id is null) or exists(select 1 from public.ps4_game_folders f where f.id=ps4_games.folder_id and not f.is_private))
    and ((select auth.uid()) is null or (select auth.uid())='3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid or exists(select 1 from public.media_users u where u.id=(select auth.uid()) and (u.role='collaborator' or (u.role='member' and u.can_view_ps4_games)))))
  or (select auth.uid())='3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid
  or created_by=(select auth.uid())
  or coalesce((select auth.uid())=any(allowed_user_ids),false)
  or exists(select 1 from public.ps4_game_folders f where f.id=ps4_games.folder_id and ((select auth.uid())='3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid or f.created_by=(select auth.uid()) or coalesce((select auth.uid())=any(f.allowed_user_ids),false)))
);
