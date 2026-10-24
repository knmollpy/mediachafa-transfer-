alter table public.media_links
  add column if not exists is_private boolean not null default false;

drop policy if exists "Shared links are readable" on public.media_links;

create policy "Public links and own private links are readable"
  on public.media_links
  for select
  to anon, authenticated
  using (is_private = false or created_by = (select auth.uid()));
