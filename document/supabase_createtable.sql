-- Supabase table creation script for yukarisancamp web-app-ts
-- Execute this file in Supabase SQL Editor.

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

