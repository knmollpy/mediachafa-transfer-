-- Restrict user-created uploads to their owner and enforce optional per-account storage limits.
create or replace function public.enforce_media_user_storage_limit()
returns trigger language plpgsql security invoker set search_path=public as $$
declare account_role text; quota bigint; used_bytes bigint;
begin
  select role,storage_limit_bytes into account_role,quota from public.media_users where id=(select auth.uid());
  if account_role='member' then
    if not exists(select 1 from public.media_users where id=(select auth.uid()) and can_upload) then
      raise exception 'Esta cuenta no tiene permiso para subir archivos.' using errcode='42501';
    end if;
    if coalesce(quota,0)>0 then
      select coalesce(sum(size_bytes),0) into used_bytes from public.media_files where created_by=(select auth.uid()) and id is distinct from new.id;
      if used_bytes + coalesce(new.size_bytes,0) > quota then
        raise exception 'Se alcanzó el cupo de almacenamiento asignado.' using errcode='23514';
      end if;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists enforce_media_user_storage_limit on public.media_files;
create trigger enforce_media_user_storage_limit before insert or update of size_bytes,created_by on public.media_files for each row execute function public.enforce_media_user_storage_limit();

drop policy if exists "Uploader accounts can move files" on public.media_files;
create policy "Collaborators and owners can move files" on public.media_files for update to authenticated
using (exists(select 1 from public.media_users u where u.id=(select auth.uid()) and u.role='collaborator'))
with check (exists(select 1 from public.media_users u where u.id=(select auth.uid()) and u.role='collaborator'));
drop policy if exists "Uploader can delete own file metadata" on public.media_files;
create policy "Uploaders can delete own file metadata" on public.media_files for delete to authenticated
using (created_by=(select auth.uid()) and exists(select 1 from public.media_users u where u.id=(select auth.uid()) and u.role='collaborator'));

-- Ordinary accounts with upload permission still cannot manage links or the PS4 catalog.
drop policy if exists "Owner and collaborators can add links" on public.media_links;
create policy "Owner and collaborators can add links" on public.media_links for insert to authenticated
with check (created_by=(select auth.uid()) and ((select auth.uid())='3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid or exists(select 1 from public.media_users u where u.id=(select auth.uid()) and u.role='collaborator')));
drop policy if exists "Owners and authors can delete links" on public.media_links;
create policy "Owners and collaborators can delete links" on public.media_links for delete to authenticated
using ((select auth.uid())='3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid or (created_by=(select auth.uid()) and exists(select 1 from public.media_users u where u.id=(select auth.uid()) and u.role='collaborator')));
drop policy if exists "Owners and authors can update links" on public.media_links;
create policy "Owners and collaborators can update links" on public.media_links for update to authenticated
using ((select auth.uid())='3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid or (created_by=(select auth.uid()) and exists(select 1 from public.media_users u where u.id=(select auth.uid()) and u.role='collaborator')))
with check ((select auth.uid())='3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid or (created_by=(select auth.uid()) and exists(select 1 from public.media_users u where u.id=(select auth.uid()) and u.role='collaborator')));

drop policy if exists "Owner and uploaders can add PS4 games" on public.ps4_games;
create policy "Owner and collaborators can add PS4 games" on public.ps4_games for insert to authenticated
with check (created_by=(select auth.uid()) and ((select auth.uid())='3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid or exists(select 1 from public.media_users u where u.id=(select auth.uid()) and u.role='collaborator')));
drop policy if exists "Owners and authors can update PS4 games" on public.ps4_games;
create policy "Owners and collaborators can update PS4 games" on public.ps4_games for update to authenticated
using ((select auth.uid())='3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid or (created_by=(select auth.uid()) and exists(select 1 from public.media_users u where u.id=(select auth.uid()) and u.role='collaborator')))
with check ((select auth.uid())='3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid or (created_by=(select auth.uid()) and exists(select 1 from public.media_users u where u.id=(select auth.uid()) and u.role='collaborator')));
drop policy if exists "Owners and authors can delete PS4 games" on public.ps4_games;
create policy "Owners and collaborators can delete PS4 games" on public.ps4_games for delete to authenticated
using ((select auth.uid())='3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid or (created_by=(select auth.uid()) and exists(select 1 from public.media_users u where u.id=(select auth.uid()) and u.role='collaborator')));

drop policy if exists "Owner and uploaders can create PS4 game folders" on public.ps4_game_folders;
create policy "Owner and collaborators can create PS4 game folders" on public.ps4_game_folders for insert to authenticated
with check (created_by=(select auth.uid()) and ((select auth.uid())='3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid or exists(select 1 from public.media_users u where u.id=(select auth.uid()) and u.role='collaborator')));
drop policy if exists "Owners and authors can update PS4 game folders" on public.ps4_game_folders;
create policy "Owners and collaborators can update PS4 game folders" on public.ps4_game_folders for update to authenticated
using ((select auth.uid())='3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid or (created_by=(select auth.uid()) and exists(select 1 from public.media_users u where u.id=(select auth.uid()) and u.role='collaborator')))
with check ((select auth.uid())='3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid or (created_by=(select auth.uid()) and exists(select 1 from public.media_users u where u.id=(select auth.uid()) and u.role='collaborator')));
drop policy if exists "Owners and authors can delete PS4 game folders" on public.ps4_game_folders;
create policy "Owners and collaborators can delete PS4 game folders" on public.ps4_game_folders for delete to authenticated
using ((select auth.uid())='3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid or (created_by=(select auth.uid()) and exists(select 1 from public.media_users u where u.id=(select auth.uid()) and u.role='collaborator')));
