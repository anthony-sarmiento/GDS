-- Fresh start: wipes every saved day, person and break press (all of it was test data),
-- then saves Anthony Sarmiento with his retail sign-in email.
-- Run it once in Supabase -> SQL Editor, AFTER schema.sql. Accounts and roles are NOT touched.

delete from public.staff_events;
delete from public.days;
delete from public.team;

insert into public.team (name, email)
values ('Anthony Sarmiento', 'puffimations@gmail.com');
