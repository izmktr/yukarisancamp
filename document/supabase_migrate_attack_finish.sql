-- Migration: support atomic completion of clan member attacks.
-- Safe to re-run.

begin;

alter table public.attack_histories
  alter column messageid drop not null;

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

  if p_action = 'defeat' and (p_overtime < 20 or p_overtime > 90) then
    raise exception 'Overtime must be between 20 and 90';
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

  if p_action <> 'cancel' then
    insert into public.attack_histories (
      source, clanid, membersource, memberid, day, sortie, messageid,
      boss, overtime, defeat, sortiecount, updatetime
    ) values (
      target_member.source,
      target_member.clanid,
      target_member.membersource,
      target_member.memberid,
      ((changed_at at time zone 'Asia/Tokyo') - interval '5 hours')::date,
      target_member.sortie,
      null,
      target_member.attackboss,
      case when p_action = 'defeat' then p_overtime else 0 end,
      p_action = 'defeat',
      case when p_action = 'defeat' then 1 else 2 end,
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

commit;