drop policy if exists "Uploader accounts can rename folders" on public.media_folders;
create policy "Collaborators can rename folders" on public.media_folders for update to authenticated
using (exists(select 1 from public.media_users u where u.id=(select auth.uid()) and u.role='collaborator'))
with check (exists(select 1 from public.media_users u where u.id=(select auth.uid()) and u.role='collaborator'));
