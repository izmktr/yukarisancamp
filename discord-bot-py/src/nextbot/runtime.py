from __future__ import annotations

import asyncio
import datetime
from typing import Any, cast

import discord
from supabase import create_async_client

from .clan import Clan
from .one_shot_scheduler import OneShotScheduler, parse_scheduled_time
from .supabase_client import SupabaseClient


class NextBotApp:
    def __init__(
        self,
        token: str,
        supabase_url: str,
        supabase_secret_key: str,
        input_channel_name: str = "凸報告",
        scheduled_run_at: str | None = None,
    ) -> None:
        intents = discord.Intents.default()
        intents.message_content = True

        self.client = discord.Client(intents=intents)
        self.token = token
        self.supabase = SupabaseClient(supabase_url, supabase_secret_key)
        self.clanbattle_setting: dict[str, Any] | None = None
        self.input_channel_name = input_channel_name
        self.scheduled_run_at = scheduled_run_at
        self._clans: dict[int, Clan] = {}
        self._one_shot_scheduler: OneShotScheduler | None = None
        self._realtime_client: Any | None = None
        self._realtime_channel: Any | None = None
        self._register_events()

    def _get_clan(self, guild: discord.Guild) -> Clan:
        clan = self._clans.get(guild.id)
        if clan is None:
            clan = Clan(self.input_channel_name, self.supabase, guild.id)
            self._clans[guild.id] = clan
        clan.clanbattle_setting = self.clanbattle_setting
        return clan

    async def _register_guild(self, guild: discord.Guild) -> None:
        registered = await asyncio.to_thread(
            self.supabase.register_clan_if_missing,
            guild.id,
            guild.name,
        )
        supabase_data = await asyncio.to_thread(self.supabase.get_clan, guild.id)
        clan = self._get_clan(guild)
        clan.supabase_data = supabase_data
        if registered:
            print(f"Supabaseにクランを登録しました: {guild.name} ({guild.id})")

    def _get_realtime_clan(
        self,
        payload: dict[str, Any],
    ) -> tuple[Clan, dict[str, Any], dict[str, Any]] | None:
        raw_data: object = payload.get("data")
        if not isinstance(raw_data, dict):
            return None

        data = cast(dict[str, object], raw_data)
        raw_record: object = data.get("record")
        if not isinstance(raw_record, dict):
            return None

        new_data = cast(dict[str, Any], raw_record)
        raw_old_record: object = data.get("old_record")
        old_data = cast(dict[str, Any], raw_old_record) if isinstance(raw_old_record, dict) else {}

        source = new_data.get("source", old_data.get("source"))
        if source != "discord":
            return None

        clan_id = new_data.get("clanid", old_data.get("clanid"))
        if not isinstance(clan_id, (int, str)):
            return None

        try:
            clan = self._clans.get(int(clan_id))
        except (TypeError, ValueError):
            return None

        if clan is None:
            return None

        return clan, old_data, new_data

    async def _on_realtime_clans_update(self, payload: dict[str, Any]) -> None:
        result = self._get_realtime_clan(payload)
        if result is not None:
            clan, old_data, new_data = result
            await clan.OnSupabaseUpdateClans(old_data, new_data)

    async def _on_realtime_clan_members_update(self, payload: dict[str, Any]) -> None:
        result = self._get_realtime_clan(payload)
        if result is not None:
            clan, old_data, new_data = result
            await clan.OnSupabaseUpdateClanMembers(old_data, new_data)

    async def _on_realtime_clan_boss_state_update(self, payload: dict[str, Any]) -> None:
        result = self._get_realtime_clan(payload)
        if result is not None:
            clan, old_data, new_data = result
            await clan.OnSupabaseUpdateClanBossState(old_data, new_data)

    async def _subscribe_supabase_updates(self) -> None:
        if self._realtime_channel is not None:
            return

        realtime_client: Any = await create_async_client(
            self.supabase.url,
            self.supabase.secret_key,
        )
        self._realtime_client = realtime_client
        channel: Any = realtime_client.channel("nextbot-database-updates")
        channel.on_postgres_changes(
            "UPDATE",
            self._on_realtime_clans_update,
            schema="public",
            table="clans",
        )
        channel.on_postgres_changes(
            "UPDATE",
            self._on_realtime_clan_members_update,
            schema="public",
            table="clan_members",
        )
        channel.on_postgres_changes(
            "UPDATE",
            self._on_realtime_clan_boss_state_update,
            schema="public",
            table="clan_boss_state",
        )

        loop = asyncio.get_running_loop()
        subscription_ready: asyncio.Future[None] = loop.create_future()

        def on_subscribe(status: object, error: Exception | None) -> None:
            if subscription_ready.done():
                return

            status_value = getattr(status, "value", None)
            if status_value == "SUBSCRIBED":
                subscription_ready.set_result(None)
            elif status_value in {"TIMED_OUT", "CLOSED", "CHANNEL_ERROR"}:
                subscription_ready.set_exception(
                    error or RuntimeError(f"Supabase Realtime subscription failed: {status_value}")
                )

        await channel.subscribe(on_subscribe)
        await asyncio.wait_for(subscription_ready, timeout=15)
        self._realtime_channel = channel
        print("Supabase Realtimeの購読を開始しました")

    def _register_events(self) -> None:
        @self.client.event
        async def on_ready() -> None:
            print("ログインしました " + datetime.datetime.now().strftime("%Y/%m/%d %H:%M:%S"))
            guild_names = [guild.name for guild in self.client.guilds]
            print("参加サーバ一覧: " + (", ".join(guild_names) if guild_names else "なし"))

            # Supabase にクラン情報を登録
            for guild in self.client.guilds:
                await self._register_guild(guild)

            # Supabase から setting_clanbattle を取得
            if self.clanbattle_setting is None:
                self.clanbattle_setting = await asyncio.to_thread(self.supabase.get_clanbattle_setting)
                print(f"setting_clanbattle(id=0): {self.clanbattle_setting}")
                for clan in self._clans.values():
                    clan.clanbattle_setting = self.clanbattle_setting

            await self._subscribe_supabase_updates()

            

            # スケジュールされた実行時間が設定されている場合、OneShotScheduler を開始
            if self.scheduled_run_at and self._one_shot_scheduler is None:
                run_at = parse_scheduled_time(self.scheduled_run_at)
                self._one_shot_scheduler = OneShotScheduler(run_at, self._run_one_shot_callback)
                self._one_shot_scheduler.start()
                print("daily schedule enabled at " + run_at.strftime("%H:%M:%S"))

        @self.client.event
        async def on_guild_join(guild: discord.Guild) -> None:
            await self._register_guild(guild)

        @self.client.event
        async def on_message(message: discord.Message) -> None:
            if message.author.bot:
                return

            if message.guild is None:
                return

            if not isinstance(message.author, discord.Member):
                return

            bot_user = self.client.user
            clan = self._get_clan(message.guild)
            await clan.on_message(message, message.author, bot_user)

    async def _run_one_shot_callback(self) -> None:
        print("one-shot callback called")

    def run(self) -> None:
        self.client.run(self.token)