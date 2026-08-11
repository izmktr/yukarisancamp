-- Migration: support atomic completion of clan member attacks.
-- Safe to re-run.

begin;

alter table public.attack_histories
  alter column messageid drop not null;

alter table public.attack_histories
  add column if not exists attacklap integer null;

create or replace function public.finish_clan_member_attack(
  p_source public.clan_source,
  p_clanid text,
  p_membersource public.clan_source,
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
  where source = p_source
    and clanid = p_clanid
    and membersource = p_membersource
    and memberid = p_memberid
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
    where source = target_member.source
      and clanid = target_member.clanid
      and cardinality(bosslaps) = 5
      and bosslaps[target_member.attackboss] = target_member.attacklap;
  end if;

  update public.clan_members
  set attackboss = 0,
      updated_at = changed_at
  where source = target_member.source
    and clanid = target_member.clanid
    and membersource = target_member.membersource
    and memberid = target_member.memberid;
end;
$$;

revoke all on function public.finish_clan_member_attack(
  public.clan_source, text, public.clan_source, text, text, integer
) from public, anon, authenticated;

grant execute on function public.finish_clan_member_attack(
  public.clan_source, text, public.clan_source, text, text, integer
) to service_role;

create or replace function public.delete_clan_member_attack_history(
  p_source public.clan_source,
  p_clanid text,
  p_membersource public.clan_source,
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
    and source = p_source
    and clanid = p_clanid
    and membersource = p_membersource
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
      and source = p_source
      and clanid = p_clanid
      and membersource = p_membersource
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
    where source = p_source
      and clanid = p_clanid
      and membersource = p_membersource
      and memberid = p_memberid
      and day = p_day
      and sortie = removed_sortie
  ) then
    update public.attack_histories
    set sortie = sortie - 1,
        updatetime = changed_at
    where source = p_source
      and clanid = p_clanid
      and membersource = p_membersource
      and memberid = p_memberid
      and day = p_day
      and sortie > removed_sortie;
  end if;
end;
$$;

revoke all on function public.delete_clan_member_attack_history(
  public.clan_source, text, public.clan_source, text, date, bigint
) from public, anon, authenticated;

grant execute on function public.delete_clan_member_attack_history(
  public.clan_source, text, public.clan_source, text, date, bigint
) to service_role;

commit;

notify pgrst, 'reload schema';