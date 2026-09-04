-- Migration: restore clanid uniqueness and Realtime row identity for clans.
-- Safe to re-run when clanid values are unique.

begin;

do $$
begin
  if exists (
    select clanid
    from public.clans
    group by clanid
    having count(*) > 1
  ) then
    raise exception 'Duplicate clanid values must be resolved before restoring clans identity';
  end if;
end
$$;

create unique index if not exists clans_clanid_unique_idx
  on public.clans (clanid);

alter table public.clans
  replica identity using index clans_clanid_unique_idx;

delete from public.clans
where clanid = '1041231929946685471'
  and name = 'diagnostic-existing-clan';

commit;

notify pgrst, 'reload schema';