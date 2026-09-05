-- Migration: consolidate clan member attack columns into attackdata and attacktime JSONB.
-- Safe to re-run.

begin;

alter table public.clan_members
  add column if not exists attackdata jsonb,
  add column if not exists attacktime jsonb not null default '[]'::jsonb;

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
        'day', yearmonth,
        'sortie', sortie,
        'lap', attacklap,
        'boss', attackboss,
        'overattack', overattack,
        'damage', damage,
        'message', attackmessage
      )
    $migration$;

    execute $migration$
      alter table public.clan_members
        drop column yearmonth,
        drop column sortie,
        drop column attacklap,
        drop column attackboss,
        drop column overattack,
        drop column damage,
        drop column attackmessage
    $migration$;
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
set attackdata = '{"day":"","sortie":0,"lap":0,"boss":0,"overattack":null,"damage":null,"message":null}'::jsonb
where attackdata is null;

alter table public.clan_members
  alter column attackdata set default '{"day":"","sortie":0,"lap":0,"boss":0,"overattack":null,"damage":null,"message":null}'::jsonb,
  alter column attackdata set not null;

update public.clan_members
set attackdata = (attackdata - 'yearmonth') || jsonb_build_object(
  'day', coalesce(attackdata->>'day', attackdata->>'yearmonth', '')
)
where attackdata ? 'yearmonth'
  or not (attackdata ? 'day');

alter table public.attack_histories
  drop constraint if exists attack_histories_yearmonth_check,
  drop column if exists yearmonth;

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

  if (target_member.attackdata->>'boss')::integer = 0 then
    raise exception 'Attack is not active';
  end if;

  if p_action = 'defeat' then
    if coalesce((target_member.attackdata->>'overattack')::integer, 0) = 1 and p_overtime <> 0 then
      raise exception 'Carry-over attack overtime must be zero';
    elsif coalesce((target_member.attackdata->>'overattack')::integer, 0) <> 1
      and p_overtime <> 0
      and (p_overtime < 20 or p_overtime > 90) then
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

revoke all on function public.finish_clan_member_attack(
  text, text, integer
) from public, anon, authenticated;

grant execute on function public.finish_clan_member_attack(
  text, text, integer
) to service_role;

do $$
begin
  if exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'clan_source'
  ) then
    execute 'drop function if exists public.delete_clan_member_attack_history(public.clan_source, text, public.clan_source, text, date, bigint)';
  end if;
end
$$;

drop function if exists public.delete_clan_member_attack_history(
  text,
  date,
  bigint
);

create function public.delete_clan_member_attack_history(
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

revoke all on function public.delete_clan_member_attack_history(
  text, date, bigint
) from public, anon, authenticated;

grant execute on function public.delete_clan_member_attack_history(
  text, date, bigint
) to service_role;

commit;

notify pgrst, 'reload schema';