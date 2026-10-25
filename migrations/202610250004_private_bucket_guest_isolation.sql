-- PS4 guest downloads currently use external MediaFire URLs; no catalog item depends
-- on anonymous access to this private general-purpose Supabase storage bucket.
-- Authenticated users can read only objects whose metadata is visible to them.
drop policy if exists "Guests can read shared game files" on storage.objects;
create policy "Signed in accounts can read visible game files" on storage.objects
for select to authenticated using (
  bucket_id='games' and (
    (select auth.uid())='3da2624d-d1cc-49e9-a536-ed8c0c480779'::uuid
    or exists (select 1 from public.media_users u where u.id=(select auth.uid()) and u.role='collaborator')
    or exists (select 1 from public.media_files f where f.storage_path=name)
  )
);
