-- RLS policies on the public PS4 catalog consult media_users. Grant the table
-- privilege needed to evaluate those policies; row visibility remains controlled by RLS.
grant select on table public.media_users to anon, authenticated;
