-- Migration: change clan-related ID columns from bigint to text
-- Target tables:
--   public.clans.clanid
--   public.clan_members.clanid
--   public.clan_members.memberid
--
-- Safe to re-run: each ALTER executes only when the current type is bigint.

begin;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'clans'
      and column_name = 'clanid'
      and data_type = 'bigint'
  ) then
    execute 'alter table public.clans alter column clanid type text using clanid::text';
  end if;
end
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'clan_members'
      and column_name = 'clanid'
      and data_type = 'bigint'
  ) then
    execute 'alter table public.clan_members alter column clanid type text using clanid::text';
  end if;
end
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'clan_members'
      and column_name = 'memberid'
      and data_type = 'bigint'
  ) then
    execute 'alter table public.clan_members alter column memberid type text using memberid::text';
  end if;
end
$$;

commit;

-- Optional verification:
-- select table_name, column_name, data_type
-- from information_schema.columns
-- where table_schema = 'public'
--   and table_name in ('clans', 'clan_members')
--   and column_name in ('clanid', 'memberid')
-- order by table_name, column_name;
