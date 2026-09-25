-- Supabase table creation script for yukarisancamp web-app-ts
-- Execute this file in Supabase SQL Editor.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'clan_member_role'
      and n.nspname = 'public'
  ) then
    create type public.clan_member_role as enum ('member', 'officer', 'leader');
  end if;
end
$$;

create table if not exists public.board_posts (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  yearmonth text not null,
  author_id text not null,
  author_name text not null,
  post_title text not null default '',
  bossname text not null,
  mode text not null,
  damage bigint not null,
  battle_time_seconds integer not null,
  battle_date timestamptz not null,
  difficulty smallint not null,
  visibility text not null,
  post_comment text not null default '',
  party jsonb not null default '[]'::jsonb,
  ub_rows jsonb not null default '[]'::jsonb,
  raw_article jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint board_posts_yearmonth_check check (yearmonth ~ '^\d{6}$'),
  constraint board_posts_visibility_check check (visibility in ('all', 'clan', 'self')),
  constraint board_posts_difficulty_check check (difficulty between 1 and 5),
  constraint board_posts_mode_check check (mode in ('full', 'agro', 'rank2', 'rank3')),
  constraint board_posts_damage_check check (damage >= 0),
  constraint board_posts_battle_time_seconds_check check (battle_time_seconds >= 0)
);

create index if not exists board_posts_yearmonth_created_at_idx
  on public.board_posts (yearmonth, created_at desc);

create table if not exists public.setting_clanbattle (
  id integer primary key,
  yearmonth text not null,
  bossname text[] not null,
  "bossHp" integer[] not null,
  "startDate" date not null,
  "endDate" date not null,
  constraint setting_clanbattle_singleton_id_check check (id = 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.setting_clanbattle_events (
  id bigint generated always as identity primary key,
  yearmonth text not null,
  event_type text not null,
  source text not null,
  triggered_by text null,
  created_at timestamptz not null default now()
);

create index if not exists setting_clanbattle_events_created_at_idx
  on public.setting_clanbattle_events (created_at desc, id desc);
create or replace view public.board_posts_current_month as
select bp.*
from public.board_posts bp
join public.setting_clanbattle sc
  on sc.id = 0
 and bp.yearmonth = sc.yearmonth;

create table if not exists public.setting_userprofile (
  "googleUserId" text primary key,
  "discordId" text null,
  "discordServer" text null,
  "displayName" text not null,
  "createdAt" bigint not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.setting_user_owned_character (
  "googleUserId" text not null,
  "officialName" text not null,
  "nickname" text not null,
  "owned" boolean not null,
  "connectRank" integer not null,
  updated_at timestamptz not null default now(),
  primary key ("googleUserId", "officialName")
);

create table if not exists public.clans (
  clanid text not null,
  name text not null,
  bosslaps integer[] not null,
  discord_data jsonb not null default '{}'::jsonb,
  "createdAt" timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (clanid),
  constraint clans_bosslaps_length_check check (cardinality(bosslaps) = 5)
);

create table if not exists public.clan_members (
  clanid text not null,
  memberid text not null,
  name text not null,
  mention text not null,
  role public.clan_member_role not null default 'member',
  taskkill date,
  day date not null,
  attacktime jsonb not null default '[]'::jsonb,
  attackdata jsonb not null default '{"day":"","sortie":0,"lap":0,"boss":0,"overattack":null,"damage":null,"message":null}'::jsonb,
  lastactive timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (clanid, memberid)
);

create index if not exists clan_members_memberid_idx
  on public.clan_members (memberid);

create table if not exists public.clan_boss_state (
  clanid text not null,
  yearmonth text not null,
  boss_index integer not null,
  current_hp integer not null default 0,
  max_hp integer not null default 0,
  is_defeated boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text null,
  primary key (clanid, yearmonth, boss_index),
  constraint clan_boss_state_yearmonth_check check (yearmonth ~ '^\d{6}$'),
  constraint clan_boss_state_boss_index_check check (boss_index between 1 and 5),
  constraint clan_boss_state_current_hp_check check (current_hp >= 0),
  constraint clan_boss_state_max_hp_check check (max_hp >= 0)
);

create index if not exists clan_boss_state_clanid_yearmonth_idx
  on public.clan_boss_state (clanid, yearmonth);

-- 既存環境で clan_boss_state に (clanid, yearmonth, boss_index) の主キーが
-- 無い/異なる列で入っているケースを補修する（upsert の on_conflict 指定に必要）。
do $$
declare
  existing_pk_name text;
  existing_pk_cols text;
begin
  select con.conname, string_agg(att.attname, ',' order by ord.n)
  into existing_pk_name, existing_pk_cols
  from pg_constraint con
  join pg_class t on t.oid = con.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  join lateral unnest(con.conkey) with ordinality as ord(attnum, n) on true
  join pg_attribute att on att.attrelid = t.oid and att.attnum = ord.attnum
  where n.nspname = 'public'
    and t.relname = 'clan_boss_state'
    and con.contype = 'p'
  group by con.conname;

  if existing_pk_name is null or existing_pk_cols <> 'clanid,yearmonth,boss_index' then
    if existing_pk_name is not null then
      execute format('alter table public.clan_boss_state drop constraint %I', existing_pk_name);
    end if;

    -- 制約追加前に重複行があれば updated_at が最新の行だけ残す
    delete from public.clan_boss_state s
    using public.clan_boss_state d
    where s.clanid = d.clanid
      and s.yearmonth = d.yearmonth
      and s.boss_index = d.boss_index
      and (s.updated_at, s.ctid) < (d.updated_at, d.ctid);

    alter table public.clan_boss_state
      add constraint clan_boss_state_pkey primary key (clanid, yearmonth, boss_index);
  end if;
end
$$;

create table if not exists public.attack_histories (
  id bigint generated by default as identity primary key,
  clanid text not null,
  memberid text not null,
  day date not null,
  sortie integer not null,
  messageid text null,
  boss integer not null,
  attacklap integer null,
  overtime integer not null,
  defeat boolean not null,
  sortiecount integer not null,
  updatetime timestamptz not null
);

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'attack_histories'
      and column_name = 'overtime'
      and data_type = 'boolean'
  ) then
    alter table public.attack_histories
      alter column overtime type integer
      using case when overtime then 1 else 0 end;
  end if;
end
$$;

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'clan_members'
  ) then
    execute 'alter publication supabase_realtime add table public.clan_members';
  end if;
end
$$;

create index if not exists attack_histories_clanid_day_idx
  on public.attack_histories (clanid, day);

create sequence if not exists public.web_entity_id_seq
  minvalue 1
  maxvalue 99999999
  no cycle;

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
  text,
  text,
  integer
);
drop function if exists public.finish_clan_member_attack(
  text,
  text,
  text,
  text,
  text,
  integer
);
drop function if exists public.finish_clan_member_attack(
  text,
  text,
  text,
  text,
  text,
  integer,
  text
);

create function public.finish_clan_member_attack(
  p_memberid text,
  p_name text,
  p_mention text,
  p_messageid text,
  p_action text,
  p_overtime integer default 0,
  p_clanid text default null
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
  attack_day date;
  is_carry_over boolean;
  history_id bigint;
  changed_at timestamptz := now();
  updated_bosslaps integer[];
  reference_day date;
  overtime_row record;
begin
  if p_action not in ('complete', 'defeat', 'cancel') then
    raise exception 'Invalid attack action';
  end if;

  if p_clanid is not null and length(trim(p_clanid)) > 0 then
    select *
    into target_member
    from public.clan_members
    where clanid = p_clanid
      and memberid = p_memberid
    for update;
  else
    select *
    into target_member
    from public.clan_members
    where (clanid, memberid) = (
      select clanid, memberid
      from public.clan_members
      where memberid = p_memberid
      order by case
                 when jsonb_typeof(attackdata->'boss') = 'number'
                      and trunc((attackdata->>'boss')::numeric)::integer between 1 and 5 then 0
                 when coalesce(attackdata->>'boss', '') ~ '^[1-5]$' then 0
                 else 1
               end,
               updated_at desc
      limit 1
    )
    for update;
  end if;

  if not found then
    raise exception 'Clan member was not found';
  end if;

  attack_data := coalesce(target_member.attackdata, '{}'::jsonb);
  attack_sortie := case
    when jsonb_typeof(attack_data->'sortie') = 'number' then trunc((attack_data->>'sortie')::numeric)::integer
    when coalesce(attack_data->>'sortie', '') ~ '^-?\d+$' then (attack_data->>'sortie')::integer
    else 0
  end;
  attack_boss := case
    when jsonb_typeof(attack_data->'boss') = 'number' then trunc((attack_data->>'boss')::numeric)::integer
    when coalesce(attack_data->>'boss', '') ~ '^-?\d+$' then (attack_data->>'boss')::integer
    else 0
  end;
  attack_lap := case
    when jsonb_typeof(attack_data->'lap') = 'number' then trunc((attack_data->>'lap')::numeric)::integer
    when coalesce(attack_data->>'lap', '') ~ '^-?\d+$' then (attack_data->>'lap')::integer
    else 0
  end;
  attack_day := case
    when coalesce(attack_data->>'day', '') ~ '^\d{4}-\d{2}-\d{2}' then left(attack_data->>'day', 10)::date
    else target_member.day
  end;
  is_carry_over := (
    case
      when jsonb_typeof(attack_data->'overattack') = 'number' then trunc((attack_data->>'overattack')::numeric)::integer
      when coalesce(attack_data->>'overattack', '') ~ '^-?\d+$' then (attack_data->>'overattack')::integer
      else 0
    end
  ) = 1;

  if attack_boss not between 1 and 5 or attack_sortie not between 1 and 3 then
    raise exception 'Attack is not active';
  end if;

  if attack_day is null then
    attack_day := ((changed_at at time zone 'Asia/Tokyo') - interval '5 hours')::date;
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
    insert into public.attack_histories (
      clanid, memberid, day, sortie, messageid, boss, attacklap,
      overtime, defeat, sortiecount, updatetime
    ) values (
      target_member.clanid,
      target_member.memberid,
      attack_day,
      attack_sortie,
      p_messageid,
      attack_boss,
      attack_lap,
      case when p_action = 'defeat' and not is_carry_over then p_overtime else 0 end,
      p_action = 'defeat',
      case when is_carry_over then 1 when p_action = 'defeat' then 1 else 2 end,
      changed_at
    ) returning id into history_id;

    -- attacktime は履歴の day ではなく、現在時刻の基準日（JST 5:00始まり）で再計算する
    reference_day := ((changed_at at time zone 'Asia/Tokyo') - interval '5 hours')::date;
    attack_times := jsonb_build_array(null, null, null);
    for overtime_row in
      select
        sub.sortie,
        max(case when sub.cnt = 1 then sub.max_overtime else 0 end) as time
      from (
        select
          sortie,
          count(sortie) as cnt,
          max(overtime) as max_overtime
        from public.attack_histories
        where day = reference_day
          and clanid = target_member.clanid
          and memberid = target_member.memberid
        group by clanid, memberid, day, sortie
      ) sub
      group by sub.sortie
      order by sub.sortie
    loop
      if overtime_row.sortie between 1 and 3 then
        attack_times := jsonb_set(
          attack_times,
          array[(overtime_row.sortie - 1)::text],
          to_jsonb(overtime_row.time),
          true
        );
      end if;
    end loop;
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

  attack_data := jsonb_build_object(
    'day', '',
    'sortie', 0,
    'lap', 0,
    'boss', 0,
    'overattack', null,
    'damage', null,
    'message', null
  );

  update public.clan_members
  set name = coalesce(nullif(p_name, ''), target_member.name),
      mention = coalesce(nullif(p_mention, ''), target_member.mention),
      day = attack_day,
      attacktime = attack_times,
      attackdata = attack_data,
      lastactive = changed_at,
      updated_at = changed_at
  where clanid = target_member.clanid
    and memberid = target_member.memberid;

  if not found then
    raise exception 'Failed to update clan member attack';
  end if;

  return jsonb_build_object(
    'history_id', history_id,
    'attacktime', attack_times,
    'attackdata', attack_data,
    'bosslaps', to_jsonb(updated_bosslaps)
  );
end;
$$;

revoke all on function public.finish_clan_member_attack(
  text,
  text,
  text,
  text,
  text,
  integer,
  text
) from public, anon, authenticated;

grant execute on function public.finish_clan_member_attack(
  text,
  text,
  text,
  text,
  text,
  integer,
  text
) to service_role;

drop function if exists public.revert_clan_member_attack(text, bigint);

create or replace function public.revert_clan_member_attack(
  p_memberid text,
  p_history_id bigint,
  p_clanid text default null
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
  -- p_clanid 未指定の古い呼び出しでは、履歴のクランで対象メンバーを特定する
  select * into strict target_history
  from public.attack_histories
  where id = p_history_id
    and memberid = p_memberid
    and (p_clanid is null or clanid = p_clanid)
  for update;

  select * into strict target_member
  from public.clan_members
  where clanid = target_history.clanid
    and memberid = p_memberid
  for update;

  if coalesce((target_member.attackdata->>'boss')::integer, 0) <> 0 then
    raise exception 'Another attack is active';
  end if;

  if exists (
    select 1 from public.attack_histories
    where clanid = target_history.clanid
      and memberid = target_history.memberid
      and day = target_history.day
      and id > target_history.id
  ) then
    raise exception 'Newer attack history exists';
  end if;

  if target_history.overtime > 0 and exists (
    select 1 from public.attack_histories
    where id <> target_history.id
      and clanid = target_history.clanid
      and memberid = target_history.memberid
      and day = target_history.day
      and sortie = target_history.sortie
  ) then
    raise exception 'Carry-over source history cannot be deleted after use';
  end if;

  select min(overtime) into restored_time
  from public.attack_histories
  where id <> target_history.id
    and clanid = target_history.clanid
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
  where clanid = target_member.clanid
    and memberid = target_member.memberid;

  return jsonb_build_object(
    'attacktime', attack_times,
    'attackdata', attack_data,
    'bosslaps', to_jsonb(updated_bosslaps)
  );
end;
$$;

revoke all on function public.revert_clan_member_attack(text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.revert_clan_member_attack(text, bigint, text)
  to service_role;

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

create or replace function public.delete_clan_member_attack_history(
  p_memberid text,
  p_day date,
  p_history_id bigint,
  p_clanid text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_clanid text;
  removed_sortie integer;
  removed_overtime integer;
  changed_at timestamptz := now();
begin
  -- p_clanid 未指定の古い呼び出しでは、削除対象の履歴のクランに限定する
  select clanid, sortie, overtime
  into target_clanid, removed_sortie, removed_overtime
  from public.attack_histories
  where id = p_history_id
    and memberid = p_memberid
    and day = p_day
    and (p_clanid is null or clanid = p_clanid)
  for update;

  if removed_sortie is null then
    raise exception 'Attack history was not found';
  end if;

  if removed_overtime > 0 and exists (
    select 1
    from public.attack_histories
    where id <> p_history_id
      and clanid = target_clanid
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
    where clanid = target_clanid
      and memberid = p_memberid
      and day = p_day
      and sortie = removed_sortie
  ) then
    update public.attack_histories
    set sortie = sortie - 1,
        updatetime = changed_at
    where clanid = target_clanid
      and memberid = p_memberid
      and day = p_day
      and sortie > removed_sortie;
  end if;
end;
$$;

revoke all on function public.delete_clan_member_attack_history(
  text,
  date,
  bigint,
  text
) from public, anon, authenticated;

grant execute on function public.delete_clan_member_attack_history(
  text,
  date,
  bigint,
  text
) to service_role;

create index if not exists attack_history_clanid_idx
  on public.attack_histories (clanid);
-- Dummy seed data (re-runnable)
insert into public.setting_clanbattle (
  id,
  yearmonth,
  bossname,
  "bossHp",
  "startDate",
  "endDate"
)
values (
  0,
  '202607',
  array['Boss A', 'Boss B', 'Boss C', 'Boss D', 'Boss E'],
  array[12000000, 15000000, 20000000, 22000000, 25000000],
  '2026-07-25',
  '2026-07-30'
);

-- board_posts は掲示板投稿を 1 行で保持する最小構成です。
-- party / ub_rows / raw_article は JSONB で、現行のファイル保存構造をそのまま移しやすくしています。

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'clans'
  ) then
    execute 'alter publication supabase_realtime add table public.clans';
  end if;
end
$$;

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'clan_boss_state'
  ) then
    execute 'alter publication supabase_realtime add table public.clan_boss_state';
  end if;
end
$$;

-- 代理操作: memberid(操作者) が delegateid(被操作者) の代わりに攻撃・凸履歴を操作できるようにする権限テーブル
create table if not exists public.member_delegations (
  clanid text not null,
  memberid text not null,
  delegateid text not null,
  created_at timestamptz not null default now(),
  primary key (clanid, memberid, delegateid)
);

create index if not exists member_delegations_clanid_memberid_idx
  on public.member_delegations (clanid, memberid);

-- ブラウザ Realtime (publishable/anon) で postgres_changes を受け取るための権限。
-- Discord bot は service_role のため不要だが、Web は anon JWT で RLS 判定される。
grant select on public.clans to anon, authenticated;
grant select on public.clan_members to anon, authenticated;
grant select on public.clan_boss_state to anon, authenticated;

alter table public.clans enable row level security;
alter table public.clan_members enable row level security;
alter table public.clan_boss_state enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'clans' and policyname = 'anon can read clans'
  ) then
    create policy "anon can read clans"
      on public.clans for select to anon using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'clan_members' and policyname = 'anon can read clan_members'
  ) then
    create policy "anon can read clan_members"
      on public.clan_members for select to anon using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'clan_boss_state' and policyname = 'anon can read clan_boss_state'
  ) then
    create policy "anon can read clan_boss_state"
      on public.clan_boss_state for select to anon using (true);
  end if;
end
$$;

notify pgrst, 'reload schema';

