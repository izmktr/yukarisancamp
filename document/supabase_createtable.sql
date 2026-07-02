-- Supabase table creation script for yukarisancamp web-app-ts
-- Execute this file in Supabase SQL Editor.

create table if not exists public.setting_clanbattle (
  yearmonth text primary key,
  bossname text[] not null,
  "bossHp" integer[] not null,
  "startDate" date not null,
  "endDate" date not null,
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
