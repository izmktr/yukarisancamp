-- Migration: identify clans by clanid and members by memberid.
-- Web-created IDs use w followed by eight digits.

begin;

create sequence if not exists public.web_entity_id_seq
  minvalue 1
  maxvalue 99999999
  no cycle;

create temporary table web_clan_id_map on commit drop as
select
  source,
  clanid as old_id,
  'w' || lpad(nextval('public.web_entity_id_seq')::text, 8, '0') as new_id
from public.clans
where source = 'web';

update public.clan_members target
set clanid = id_map.new_id
from web_clan_id_map id_map
where target.source = id_map.source
  and target.clanid = id_map.old_id;

update public.clan_boss_state target
set clanid = id_map.new_id
from web_clan_id_map id_map
where target.source = id_map.source
  and target.clanid = id_map.old_id;

update public.attack_histories target
set clanid = id_map.new_id
from web_clan_id_map id_map
where target.source = id_map.source
  and target.clanid = id_map.old_id;

update public.clans target
set clanid = id_map.new_id
from web_clan_id_map id_map
where target.source = id_map.source
  and target.clanid = id_map.old_id;

create temporary table web_member_id_map on commit drop as
select
  source,
  clanid,
  membersource,
  memberid as old_id,
  'w' || lpad(nextval('public.web_entity_id_seq')::text, 8, '0') as new_id
from public.clan_members
where membersource = 'web';

update public.attack_histories target
set memberid = id_map.new_id
from web_member_id_map id_map
where target.source = id_map.source
  and target.clanid = id_map.clanid
  and target.membersource = id_map.membersource
  and target.memberid = id_map.old_id;

update public.clan_members target
set memberid = id_map.new_id
from web_member_id_map id_map
where target.source = id_map.source
  and target.clanid = id_map.clanid
  and target.membersource = id_map.membersource
  and target.memberid = id_map.old_id;

do $$
begin
  if exists (
    select clanid
    from public.clans
    group by clanid
    having count(*) > 1
  ) then
    raise exception 'Duplicate Discord clanid values prevent migration';
  end if;

  if exists (
    select memberid
    from public.clan_members
    group by memberid
    having count(*) > 1
  ) then
    raise exception 'Duplicate Discord memberid values prevent migration';
  end if;
end
$$;

alter table public.clans drop constraint if exists clans_pkey;
alter table public.clans add primary key (clanid);

alter table public.clan_members drop constraint if exists clan_members_pkey;
alter table public.clan_members add primary key (memberid);

alter table public.clan_boss_state drop constraint if exists clan_boss_state_pkey;
alter table public.clan_boss_state add primary key (clanid, yearmonth, boss_index);

drop index if exists public.clan_boss_state_source_clanid_yearmonth_idx;
create index if not exists clan_boss_state_clanid_yearmonth_idx
  on public.clan_boss_state (clanid, yearmonth);

drop index if exists public.attack_histories_source_clanid_day_idx;
create index if not exists attack_histories_clanid_day_idx
  on public.attack_histories (clanid, day);

create or replace function public.generate_web_id()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  generated_id text;
begin
  loop
    generated_id := 'w' || lpad(nextval('public.web_entity_id_seq')::text, 8, '0');
    exit when not exists (select 1 from public.clans where clanid = generated_id)
      and not exists (select 1 from public.clan_members where memberid = generated_id);
  end loop;
  return generated_id;
end;
$$;

revoke all on function public.generate_web_id() from public, anon, authenticated;
grant execute on function public.generate_web_id() to service_role;

drop function if exists public.finish_clan_member_attack(
  public.clan_source, text, public.clan_source, text, text, integer
);

create or replace function public.finish_clan_member_attack(
  p_memberid text,
  p_action text,
  p_overtime integer default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_member public.clan_members%rowtype;
  changed_at timestamptz := now();
begin
  if p_action not in ('complete', 'defeat', 'cancel') then
    raise exception 'Invalid attack action';
  end if;

  select *
  into strict target_member
  from public.clan_members
  where memberid = p_memberid
  for update;

  if target_member.attackboss = 0 then
    raise exception 'Attack is not active';
  end if;

  if p_action = 'defeat' then
    if coalesce(target_member.overattack, 0) = 1 and p_overtime <> 0 then
      raise exception 'Carry-over attack overtime must be zero';
    elsif coalesce(target_member.overattack, 0) <> 1
      and (p_overtime < 20 or p_overtime > 90) then
      raise exception 'Overtime must be between 20 and 90';
    end if;
  end if;

  if p_action <> 'cancel' then
    insert into public.attack_histories (
      source, clanid, membersource, memberid, day, sortie, messageid,
      boss, attacklap, overtime, defeat, sortiecount, updatetime
    ) values (
      target_member.source,
      target_member.clanid,
      target_member.membersource,
      target_member.memberid,
      ((changed_at at time zone 'Asia/Tokyo') - interval '5 hours')::date,
      target_member.sortie,
      null,
      target_member.attackboss,
      target_member.attacklap,
      case
        when coalesce(target_member.overattack, 0) = 1 then 0
        when p_action = 'defeat' then p_overtime
        else 0
      end,
      p_action = 'defeat',
      case
        when coalesce(target_member.overattack, 0) = 1 then 1
        when p_action = 'defeat' then 1
        else 2
      end,
      changed_at
    );
  end if;

  if p_action = 'defeat' then
    update public.clans
    set bosslaps[target_member.attackboss] = bosslaps[target_member.attackboss] + 1,
        updated_at = changed_at
    where clanid = target_member.clanid
      and cardinality(bosslaps) = 5
      and bosslaps[target_member.attackboss] = target_member.attacklap;
  end if;

  update public.clan_members
  set attackboss = 0,
      updated_at = changed_at
  where memberid = target_member.memberid;
end;
$$;

revoke all on function public.finish_clan_member_attack(text, text, integer)
  from public, anon, authenticated;
grant execute on function public.finish_clan_member_attack(text, text, integer)
  to service_role;

drop function if exists public.delete_clan_member_attack_history(
  public.clan_source, text, public.clan_source, text, date, bigint
);

create or replace function public.delete_clan_member_attack_history(
  p_memberid text,
  p_day date,
  p_history_id bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  removed_sortie integer;
  removed_overtime integer;
  changed_at timestamptz := now();
begin
  select sortie, overtime
  into removed_sortie, removed_overtime
  from public.attack_histories
  where id = p_history_id
    and memberid = p_memberid
    and day = p_day
  for update;

  if removed_sortie is null then
    raise exception 'Attack history was not found';
  end if;

  if removed_overtime > 0 and exists (
    select 1
    from public.attack_histories
    where id <> p_history_id
      and memberid = p_memberid
      and day = p_day
      and sortie = removed_sortie
  ) then
    raise exception 'Carry-over source history cannot be deleted after use';
  end if;

  delete from public.attack_histories
  where id = p_history_id;

  if not exists (
    select 1
    from public.attack_histories
    where memberid = p_memberid
      and day = p_day
      and sortie = removed_sortie
  ) then
    update public.attack_histories
    set sortie = sortie - 1,
        updatetime = changed_at
    where memberid = p_memberid
      and day = p_day
      and sortie > removed_sortie;
  end if;
end;
$$;

revoke all on function public.delete_clan_member_attack_history(text, date, bigint)
  from public, anon, authenticated;
grant execute on function public.delete_clan_member_attack_history(text, date, bigint)
  to service_role;

commit;

notify pgrst, 'reload schema';