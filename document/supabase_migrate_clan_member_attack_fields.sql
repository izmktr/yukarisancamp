-- Migration: move attacktime out of attackdata and shorten attack field names.

begin;

alter table public.clan_members
  add column if not exists attacktime jsonb not null default '[]'::jsonb;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'clan_members'
      and column_name = 'attacktime'
      and data_type <> 'jsonb'
  ) then
    alter table public.clan_members alter column attacktime drop default;
    alter table public.clan_members alter column attacktime type jsonb using to_jsonb(attacktime);
    alter table public.clan_members alter column attacktime set default '[]'::jsonb;
  end if;
end
$$;

update public.clan_members
set attacktime = attackdata->'attacktime'
where attackdata ? 'attacktime'
  and jsonb_typeof(attackdata->'attacktime') = 'array'
  and attacktime = '[]'::jsonb;

update public.clan_members
set attackdata = (attackdata - 'attacktime' - 'attacklap' - 'attackboss' - 'attackmessage')
  || jsonb_build_object(
    'lap', coalesce(attackdata->'lap', attackdata->'attacklap', '0'::jsonb),
    'boss', coalesce(attackdata->'boss', attackdata->'attackboss', '0'::jsonb),
    'message', coalesce(attackdata->'message', attackdata->'attackmessage', 'null'::jsonb)
  );

alter table public.clan_members
  alter column attackdata set default '{"day":"","sortie":0,"lap":0,"boss":0,"overattack":null,"damage":null,"message":null}'::jsonb;

drop function if exists public.finish_clan_member_attack(text, text, integer);

create function public.finish_clan_member_attack(
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

  select * into strict target_member
  from public.clan_members
  where memberid = p_memberid
  for update;

  if (target_member.attackdata->>'boss')::integer = 0 then
    raise exception 'Attack is not active';
  end if;

  if p_action = 'defeat' then
    if coalesce((target_member.attackdata->>'overattack')::integer, 0) = 1 and p_overtime <> 0 then
      raise exception 'Carry-over attack overtime must be zero';
    elsif coalesce((target_member.attackdata->>'overattack')::integer, 0) <> 1
      and p_overtime <> 0 and (p_overtime < 20 or p_overtime > 90) then
      raise exception 'Overtime must be zero or between 20 and 90';
    end if;
  end if;

  if p_action <> 'cancel' then
    insert into public.attack_histories (
      clanid, memberid, day, sortie, messageid, boss, attacklap,
      overtime, defeat, sortiecount, updatetime
    ) values (
      target_member.clanid,
      target_member.memberid,
      ((changed_at at time zone 'Asia/Tokyo') - interval '5 hours')::date,
      (target_member.attackdata->>'sortie')::integer,
      null,
      (target_member.attackdata->>'boss')::integer,
      (target_member.attackdata->>'lap')::integer,
      case
        when coalesce((target_member.attackdata->>'overattack')::integer, 0) = 1 then 0
        when p_action = 'defeat' then p_overtime
        else 0
      end,
      p_action = 'defeat',
      case
        when coalesce((target_member.attackdata->>'overattack')::integer, 0) = 1 then 1
        when p_action = 'defeat' then 1
        else 2
      end,
      changed_at
    );
  end if;

  if p_action = 'defeat' then
    update public.clans
    set bosslaps[(target_member.attackdata->>'boss')::integer] = bosslaps[(target_member.attackdata->>'boss')::integer] + 1,
        updated_at = changed_at
    where clanid = target_member.clanid
      and cardinality(bosslaps) = 5
      and bosslaps[(target_member.attackdata->>'boss')::integer] = (target_member.attackdata->>'lap')::integer;
  end if;

  update public.clan_members
  set attackdata = jsonb_set(attackdata, '{boss}', '0'::jsonb),
      updated_at = changed_at
  where memberid = target_member.memberid;
end;
$$;

revoke all on function public.finish_clan_member_attack(text, text, integer)
  from public, anon, authenticated;
grant execute on function public.finish_clan_member_attack(text, text, integer)
  to service_role;

notify pgrst, 'reload schema';

commit;