-- Supabase table creation script for yukarisancamp web-app-ts
-- Execute this file in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.clan (
  id bigint primary key,
  name text not null,
  bossindex integer[] not null default array[1, 1, 1, 1, 1],
  "createdAt" timestamptz not null default now(),
  constraint clan_bossindex_length_check check (cardinality(bossindex) = 5)
);

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

