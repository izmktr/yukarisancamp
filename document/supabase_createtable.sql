-- Supabase table creation script for yukarisancamp web-app-ts
-- Execute this file in Supabase SQL Editor.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'clan_source'
      and n.nspname = 'public'
  ) then
    create type public.clan_source as enum ('discord', 'web');
  end if;
end
$$;

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
  source public.clan_source not null,
  clanid text not null,
  name text not null,
  bosslaps integer[] not null,
  "createdAt" timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (source, clanid),
  constraint clans_bosslaps_length_check check (cardinality(bosslaps) = 5)
);

create table if not exists public.clan_members (
  source public.clan_source not null,
  clanid text not null,
  membersource public.clan_source not null,
  memberid text not null,
  name text not null,
  mention text not null,
  role public.clan_member_role not null default 'member',
  taskkill integer not null default 0,
  plan integer[] not null default '{}'::integer[],
  attacktime integer[] not null default '{}'::integer[],
  sortie integer not null default 0,
  attackboss integer not null default 0,
  attacklap integer not null default 0,
  overattack integer null,
  damage integer null,
  attackmessage text null,
  lastactive timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (source, clanid, membersource, memberid)
);

create table if not exists public.clan_boss_state (
  source public.clan_source not null,
  clanid text not null,
  yearmonth text not null,
  boss_index integer not null,
  current_hp integer not null default 0,
  max_hp integer not null default 0,
  is_defeated boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text null,
  primary key (source, clanid, yearmonth, boss_index),
  constraint clan_boss_state_yearmonth_check check (yearmonth ~ '^\d{6}$'),
  constraint clan_boss_state_boss_index_check check (boss_index between 1 and 5),
  constraint clan_boss_state_current_hp_check check (current_hp >= 0),
  constraint clan_boss_state_max_hp_check check (max_hp >= 0)
);

create index if not exists clan_boss_state_source_clanid_yearmonth_idx
  on public.clan_boss_state (source, clanid, yearmonth);

create table if not exists public.attack_histories (
  id bigint generated by default as identity primary key,
  source public.clan_source not null,
  clanid text not null,
  membersource public.clan_source not null,
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

create index if not exists attack_histories_source_clanid_day_idx
  on public.attack_histories (source, clanid, day);

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
      source,
      clanid,
      membersource,
      memberid,
      day,
      sortie,
      messageid,
      boss,
      attacklap,
      overtime,
      defeat,
      sortiecount,
      updatetime
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
  public.clan_source,
  text,
  public.clan_source,
  text,
  text,
  integer
) from public, anon, authenticated;

grant execute on function public.finish_clan_member_attack(
  public.clan_source,
  text,
  public.clan_source,
  text,
  text,
  integer
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
  public.clan_source,
  text,
  public.clan_source,
  text,
  date,
  bigint
) from public, anon, authenticated;

grant execute on function public.delete_clan_member_attack_history(
  public.clan_source,
  text,
  public.clan_source,
  text,
  date,
  bigint
) to service_role;

create index if not exists attack_history_clanid_idx
  on public.attack_history (clanid);
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

notify pgrst, 'reload schema';

