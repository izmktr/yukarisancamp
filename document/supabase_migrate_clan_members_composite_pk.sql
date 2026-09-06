-- Migrate clan_members from a memberid-only primary key to a clan/member key.
-- Safe to re-run.

begin;

alter table public.clan_members
  drop constraint if exists clan_members_pkey;

alter table public.clan_members
  add constraint clan_members_pkey primary key (clanid, memberid);

create index if not exists clan_members_memberid_idx
  on public.clan_members (memberid);

commit;

notify pgrst, 'reload schema';
