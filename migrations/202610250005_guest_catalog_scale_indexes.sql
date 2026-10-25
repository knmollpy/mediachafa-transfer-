-- Cover owner/report joins and evaluate Auth context once per statement in RLS.
create index if not exists media_users_created_by_idx on public.media_users(created_by);
create index if not exists ps4_game_reports_submitted_by_idx on public.ps4_game_reports(submitted_by);

drop policy if exists "Files visible to authorized accounts" on public.media_files;
create policy "Files visible to authorized accounts" on public.media_files
for select to authenticated using (
  (select auth.uid()) = '3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid
  or exists (select 1 from public.media_users u where u.id=(select auth.uid()) and u.role='collaborator')
  or exists (select 1 from public.media_users u where u.id=(select auth.uid()) and u.role='member' and
    ((not is_private and u.can_view_public_files) or (select auth.uid())=created_by or (select auth.uid())=any(coalesce(allowed_user_ids,'{}'::uuid[]))))
);

drop policy if exists "Folders visible to authorized accounts" on public.media_folders;
create policy "Folders visible to authorized accounts" on public.media_folders
for select to authenticated using (
  (select auth.uid()) = '3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid
  or exists (select 1 from public.media_users u where u.id=(select auth.uid()) and u.role='collaborator')
  or exists (select 1 from public.media_users u where u.id=(select auth.uid()) and u.role='member' and
    ((not is_private and u.can_view_public_files) or (select auth.uid())=created_by or (select auth.uid())=any(coalesce(allowed_user_ids,'{}'::uuid[]))))
);

drop policy if exists "Authorized accounts can read links" on public.media_links;
create policy "Authorized accounts can read links" on public.media_links
for select to authenticated using (
  (select auth.uid()) = '3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid
  or exists (select 1 from public.media_users u where u.id=(select auth.uid()) and u.role='collaborator')
  or exists (select 1 from public.media_users u where u.id=(select auth.uid()) and u.role='member' and u.can_view_links and (not is_private or created_by=(select auth.uid())))
);

drop policy if exists "Authorized accounts can add folders" on public.media_folders;
create policy "Authorized accounts can add folders" on public.media_folders
for insert to authenticated with check (
  created_by=(select auth.uid()) and (
    (select auth.uid())='3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid
    or exists (select 1 from public.media_users u where u.id=(select auth.uid()) and (u.role='collaborator' or (u.role='member' and u.can_create_folders)))
  )
);

drop policy if exists "Anyone can report a PS4 game link" on public.ps4_game_reports;
create policy "Anyone can report a PS4 game link" on public.ps4_game_reports
for insert to anon, authenticated with check (submitted_by is null or submitted_by=(select auth.uid()));
drop policy if exists "Only owner can read game reports" on public.ps4_game_reports;
create policy "Only owner can read game reports" on public.ps4_game_reports
for select to authenticated using ((select auth.uid())='3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid);
drop policy if exists "Only owner can update game reports" on public.ps4_game_reports;
create policy "Only owner can update game reports" on public.ps4_game_reports
for update to authenticated using ((select auth.uid())='3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid) with check ((select auth.uid())='3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid);
drop policy if exists "Only owner can delete game reports" on public.ps4_game_reports;
create policy "Only owner can delete game reports" on public.ps4_game_reports
for delete to authenticated using ((select auth.uid())='3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid);
