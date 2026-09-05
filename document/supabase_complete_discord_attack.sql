-- Complete Discord attack handling and reaction rollback.
-- Safe to re-run after supabase_migrate_clan_member_attack_fields.sql.

begin;

drop function if exists public.finish_clan_member_attack(text, text, integer);
drop function if exists public.finish_clan_member_attack(text, text, text, text, text, integer);

create function public.finish_clan_member_attack(
  p_memberid text,
  p_name text,
  p_mention text,
  p_messageid text,
  p_action text,
  p_overtime integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_member public.clan_members%rowtype;
  attack_data jsonb;
  attack_times jsonb;
  attack_sortie integer;
  attack_boss integer;
  attack_lap integer;
  is_carry_over boolean;
  history_id bigint;
  changed_at timestamptz := now();
  updated_bosslaps integer[];
begin
  if p_action not in ('complete', 'defeat', 'cancel') then
    raise exception 'Invalid attack action';
  end if;

  select * into strict target_member
  from public.clan_members
  where memberid = p_memberid
  for update;

  attack_data := target_member.attackdata;
  attack_sortie := coalesce((attack_data->>'sortie')::integer, 0);
  attack_boss := coalesce((attack_data->>'boss')::integer, 0);
  attack_lap := coalesce((attack_data->>'lap')::integer, 0);
  is_carry_over := coalesce((attack_data->>'overattack')::integer, 0) = 1;

  if attack_boss not between 1 and 5 or attack_sortie not between 1 and 3 then
    raise exception 'Attack is not active';
  end if;

  if p_action = 'defeat' then
    if is_carry_over and p_overtime <> 0 then
      raise exception 'Carry-over attack overtime must be zero';
    elsif not is_carry_over and (p_overtime < 20 or p_overtime > 90) then
      raise exception 'Overtime must be between 20 and 90';
    end if;
  elsif p_overtime <> 0 then
    raise exception 'Overtime must be zero';
  end if;

  attack_times := jsonb_build_array(
    target_member.attacktime->0,
    target_member.attacktime->1,
    target_member.attacktime->2
  );

  if p_action <> 'cancel' then
    attack_times := jsonb_set(
      attack_times,
      array[(attack_sortie - 1)::text],
      to_jsonb(case
        when p_action = 'defeat' and not is_carry_over then p_overtime
        else 0
      end),
      true
    );

    insert into public.attack_histories (
      clanid, memberid, day, sortie, messageid, boss, attacklap,
      overtime, defeat, sortiecount, updatetime
    ) values (
      target_member.clanid,
      target_member.memberid,
      coalesce(nullif(attack_data->>'day', '')::date,
        ((changed_at at time zone 'Asia/Tokyo') - interval '5 hours')::date),
      attack_sortie,
      p_messageid,
      attack_boss,
      attack_lap,
      case when p_action = 'defeat' and not is_carry_over then p_overtime else 0 end,
      p_action = 'defeat',
      case when is_carry_over then 1 when p_action = 'defeat' then 1 else 2 end,
      changed_at
    ) returning id into history_id;
  end if;

  if p_action = 'defeat' then
    update public.clans
    set bosslaps[attack_boss] = bosslaps[attack_boss] + 1,
        updated_at = changed_at
    where clanid = target_member.clanid
      and cardinality(bosslaps) = 5
      and bosslaps[attack_boss] = attack_lap
    returning bosslaps into updated_bosslaps;

    if updated_bosslaps is null then
      raise exception 'Boss lap has already changed';
    end if;
  else
    select bosslaps into updated_bosslaps
    from public.clans
    where clanid = target_member.clanid;
  end if;

  attack_data := '{"day":"","sortie":0,"lap":0,"boss":0,"overattack":null,"damage":null,"message":null}'::jsonb;

  update public.clan_members
  set name = p_name,
      mention = p_mention,
      attacktime = attack_times,
      attackdata = attack_data,
      lastactive = changed_at,
      updated_at = changed_at
  where memberid = target_member.memberid;

  return jsonb_build_object(
    'history_id', history_id,
    'attacktime', attack_times,
    'attackdata', attack_data,
    'bosslaps', to_jsonb(updated_bosslaps)
  );
end;
$$;

revoke all on function public.finish_clan_member_attack(
  text, text, text, text, text, integer
) from public, anon, authenticated;
grant execute on function public.finish_clan_member_attack(
  text, text, text, text, text, integer
) to service_role;

create or replace function public.revert_clan_member_attack(
  p_memberid text,
  p_history_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_member public.clan_members%rowtype;
  target_history public.attack_histories%rowtype;
  attack_times jsonb;
  restored_time integer;
  restored_overattack integer;
  attack_data jsonb;
  changed_at timestamptz := now();
  updated_bosslaps integer[];
begin
  select * into strict target_member
  from public.clan_members
  where memberid = p_memberid
  for update;

  if coalesce((target_member.attackdata->>'boss')::integer, 0) <> 0 then
    raise exception 'Another attack is active';
  end if;

  select * into strict target_history
  from public.attack_histories
  where id = p_history_id
    and memberid = p_memberid
  for update;

  if exists (
    select 1 from public.attack_histories
    where memberid = target_history.memberid
      and day = target_history.day
      and id > target_history.id
  ) then
    raise exception 'Newer attack history exists';
  end if;

  if target_history.overtime > 0 and exists (
    select 1 from public.attack_histories
    where id <> target_history.id
      and memberid = target_history.memberid
      and day = target_history.day
      and sortie = target_history.sortie
  ) then
    raise exception 'Carry-over source history cannot be deleted after use';
  end if;

  select min(overtime) into restored_time
  from public.attack_histories
  where id <> target_history.id
    and memberid = target_history.memberid
    and day = target_history.day
    and sortie = target_history.sortie;

  restored_overattack := case when restored_time is not null and restored_time > 0 then 1 else 0 end;
  attack_times := jsonb_build_array(
    target_member.attacktime->0,
    target_member.attacktime->1,
    target_member.attacktime->2
  );
  attack_times := jsonb_set(
    attack_times,
    array[(target_history.sortie - 1)::text],
    coalesce(to_jsonb(restored_time), 'null'::jsonb),
    true
  );

  if target_history.defeat then
    update public.clans
    set bosslaps[target_history.boss] = bosslaps[target_history.boss] - 1,
        updated_at = changed_at
    where clanid = target_history.clanid
      and cardinality(bosslaps) = 5
      and bosslaps[target_history.boss] = target_history.attacklap + 1
    returning bosslaps into updated_bosslaps;

    if updated_bosslaps is null then
      raise exception 'Boss lap cannot be reverted';
    end if;
  else
    select bosslaps into updated_bosslaps
    from public.clans
    where clanid = target_history.clanid;
  end if;

  delete from public.attack_histories where id = target_history.id;

  attack_data := jsonb_build_object(
    'day', target_history.day::text,
    'sortie', target_history.sortie,
    'lap', target_history.attacklap,
    'boss', target_history.boss,
    'overattack', restored_overattack,
    'damage', 0,
    'message', target_history.messageid
  );

  update public.clan_members
  set attacktime = attack_times,
      attackdata = attack_data,
      lastactive = changed_at,
      updated_at = changed_at
  where memberid = target_member.memberid;

  return jsonb_build_object(
    'attacktime', attack_times,
    'attackdata', attack_data,
    'bosslaps', to_jsonb(updated_bosslaps)
  );
end;
$$;

revoke all on function public.revert_clan_member_attack(text, bigint)
  from public, anon, authenticated;
grant execute on function public.revert_clan_member_attack(text, bigint)
  to service_role;

commit;

notify pgrst, 'reload schema';
