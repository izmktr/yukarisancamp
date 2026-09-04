-- Migration: consolidate clan member attack columns into attackdata JSONB.
-- Safe to re-run.

begin;

alter table public.clan_members
  add column if not exists attackdata jsonb;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'clan_members'
      and column_name = 'yearmonth'
  ) then
    execute $migration$
      update public.clan_members
      set attackdata = coalesce(attackdata, '{}'::jsonb) || jsonb_build_object(
        'yearmonth', yearmonth,
        'sortie', sortie,
        'attacklap', attacklap,
        'attackboss', attackboss,
        'overattack', overattack,
        'attacktime', to_jsonb(attacktime),
        'damage', damage,
        'attackmessage', attackmessage
      )
    $migration$;

    execute $migration$
      alter table public.clan_members
        drop column yearmonth,
        drop column sortie,
        drop column attacklap,
        drop column attackboss,
        drop column overattack,
        drop column attacktime,
        drop column damage,
        drop column attackmessage
    $migration$;
  end if;
end
$$;

update public.clan_members
set attackdata = '{"yearmonth":"","sortie":0,"attacklap":0,"attackboss":0,"overattack":null,"attacktime":[],"damage":null,"attackmessage":null}'::jsonb
where attackdata is null;

alter table public.clan_members
  alter column attackdata set default '{"yearmonth":"","sortie":0,"attacklap":0,"attackboss":0,"overattack":null,"attacktime":[],"damage":null,"attackmessage":null}'::jsonb,
  alter column attackdata set not null;

do $$
begin
  if exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'clan_source'
  ) then
    execute 'drop function if exists public.finish_clan_member_attack(public.clan_source, text, public.clan_source, text, text, integer)';
  end if;
end
$$;

drop function if exists public.finish_clan_member_attack(
  text,
  text,
  integer
);

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

  select *
  into strict target_member
  from public.clan_members
  where memberid = p_memberid
  for update;

  if (target_member.attackdata->>'attackboss')::integer = 0 then
    raise exception 'Attack is not active';
  end if;

  if p_action = 'defeat' then
    if coalesce((target_member.attackdata->>'overattack')::integer, 0) = 1 and p_overtime <> 0 then
      raise exception 'Carry-over attack overtime must be zero';
    elsif coalesce((target_member.attackdata->>'overattack')::integer, 0) <> 1
      and (p_overtime < 20 or p_overtime > 90) then
      raise exception 'Overtime must be between 20 and 90';
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
      (target_member.attackdata->>'attackboss')::integer,
      (target_member.attackdata->>'attacklap')::integer,
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
    set bosslaps[(target_member.attackdata->>'attackboss')::integer] = bosslaps[(target_member.attackdata->>'attackboss')::integer] + 1,
        updated_at = changed_at
    where clanid = target_member.clanid
      and cardinality(bosslaps) = 5
      and bosslaps[(target_member.attackdata->>'attackboss')::integer] = (target_member.attackdata->>'attacklap')::integer;
  end if;

  update public.clan_members
  set attackdata = jsonb_set(attackdata, '{attackboss}', '0'::jsonb),
      updated_at = changed_at
  where memberid = target_member.memberid;
end;
$$;

revoke all on function public.finish_clan_member_attack(
  text, text, integer
) from public, anon, authenticated;

grant execute on function public.finish_clan_member_attack(
  text, text, integer
) to service_role;

commit;

notify pgrst, 'reload schema';