from __future__ import annotations

import asyncio
import datetime
from typing import Any, cast

import discord
from supabase import create_async_client

from . import constants
from .clan import Clan
from .one_shot_scheduler import MinuteScheduler
from .supabase_client import SupabaseClient


class NextBotApp:
    def __init__(
        self,
        token: str,
        supabase_url: str,
        supabase_secret_key: str,
        yukalink_common_key: str,
        input_channel_name: str = "凸報告",
    ) -> None:
        intents = discord.Intents.default()
        intents.message_content = True

        self.client = discord.Client(intents=intents)
        self.token = token
        self.supabase = SupabaseClient(supabase_url, supabase_secret_key)
        self.yukalink_common_key = yukalink_common_key
        self.clanbattle_setting: dict[str, Any] | None = None
        self.input_channel_name = input_channel_name
        self._clans: dict[int, Clan] = {}
        self._minute_scheduler: MinuteScheduler | None = None
        self._last_scheduled_run: datetime.datetime | None = None
        self._realtime_client: Any | None = None
        self._realtime_channel: Any | None = None
        self._register_events()

    def _get_clan(self, guild: discord.Guild) -> Clan:
        clan = self._clans.get(guild.id)
        if clan is None:
            clan = Clan(
                self.input_channel_name,
                self.supabase,
                guild.id,
                self.yukalink_common_key,
                guild,
            )
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
        member_rows = await asyncio.to_thread(self.supabase.get_clan_members, guild.id)
        overtime_rows = await asyncio.to_thread(
            self.supabase.get_attack_overtimes,
            constants.reference_date(),
            guild.id,
        )
        clan = self._get_clan(guild)
        clan.supabase_data = supabase_data
        clan.ApplyDiscordData(supabase_data.get("discord_data"))
        clan.LoadSupabaseMembers(member_rows)
        clan.ApplyAttackOvertimes(overtime_rows)
        if registered:
            print(f"Supabaseにクランを登録しました: {guild.name} ({guild.id})")

    async def _load_clan_boss_states(self) -> None:
        if self.clanbattle_setting is None:
            return

        raw_yearmonth = self.clanbattle_setting.get("yearmonth")
        if not isinstance(raw_yearmonth, str):
            return

        raw_bosshp = self.clanbattle_setting.get("bossHp")
        for clan in self._clans.values():
            if not clan.clan_id:
                continue
            states = await asyncio.to_thread(
                self.supabase.get_clan_boss_states,
                clan.clan_id,
                raw_yearmonth,
            )
            clan.LoadSupabaseBossStates(states, raw_bosshp)

    def _get_realtime_clan(
        self,
        payload: dict[str, Any],
    ) -> tuple[Clan, dict[str, Any], dict[str, Any]] | None:
        raw_data: object = payload.get("data")
        if not isinstance(raw_data, dict):
            return None

        data = cast(dict[str, object], raw_data)
        raw_record: object = data.get("record")
        raw_old_record: object = data.get("old_record")
        new_data = cast(dict[str, Any], raw_record) if isinstance(raw_record, dict) else {}
        old_data = cast(dict[str, Any], raw_old_record) if isinstance(raw_old_record, dict) else {}

        if not new_data and not old_data:
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

    def _schedule_realtime_clans_update(self, payload: dict[str, Any]) -> None:
        asyncio.create_task(self._on_realtime_clans_update(payload))

    def _schedule_realtime_clan_members_update(self, payload: dict[str, Any]) -> None:
        asyncio.create_task(self._on_realtime_clan_members_update(payload))

    def _schedule_realtime_clan_boss_state_update(self, payload: dict[str, Any]) -> None:
        asyncio.create_task(self._on_realtime_clan_boss_state_update(payload))

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
            self._schedule_realtime_clans_update,
            schema="public",
            table="clans",
        )
        channel.on_postgres_changes(
            "*",
            self._schedule_realtime_clan_members_update,
            schema="public",
            table="clan_members",
        )
        channel.on_postgres_changes(
            "UPDATE",
            self._schedule_realtime_clan_boss_state_update,
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

            await self._load_clan_boss_states()

            await self._subscribe_supabase_updates()

            if self._minute_scheduler is None:
                self._last_scheduled_run = constants.now_jst()
                self._minute_scheduler = MinuteScheduler(self._run_minute_callback)
                self._minute_scheduler.start()
                print("minute schedule enabled")

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

        @self.client.event
        async def on_raw_reaction_add(payload: discord.RawReactionActionEvent) -> None:
            bot_user = self.client.user
            if payload.guild_id is None or (bot_user is not None and payload.user_id == bot_user.id):
                return
            clan = self._clans.get(payload.guild_id)
            if clan is not None:
                await clan.OnRawReactionAdd(payload)

        @self.client.event
        async def on_raw_reaction_remove(payload: discord.RawReactionActionEvent) -> None:
            bot_user = self.client.user
            if payload.guild_id is None or (bot_user is not None and payload.user_id == bot_user.id):
                return
            clan = self._clans.get(payload.guild_id)
            if clan is not None:
                await clan.OnRawReactionRemove(payload)

    async def _run_minute_callback(self) -> None:
        now = constants.now_jst()
        last_run = self._last_scheduled_run
        if last_run is None:
            self._last_scheduled_run = now
            return
        try:
            await self._on_minute_tick(last_run, now)
        finally:
            self._last_scheduled_run = now

    @staticmethod
    def _setting_date(setting: dict[str, Any] | None, key: str) -> datetime.date | None:
        if setting is None:
            return None
        raw_value = setting.get(key)
        if isinstance(raw_value, datetime.datetime):
            return constants.as_jst(raw_value).date()
        if isinstance(raw_value, datetime.date):
            return raw_value
        if isinstance(raw_value, str) and len(raw_value) >= 10:
            try:
                return datetime.date.fromisoformat(raw_value[:10])
            except ValueError:
                return None
        return None

    async def _reload_clanbattle_setting(self) -> None:
        setting = await asyncio.to_thread(self.supabase.get_clanbattle_setting)
        self.clanbattle_setting = setting
        for clan in self._clans.values():
            clan.clanbattle_setting = setting
        print(f"setting_clanbattle を再読み込みしました: {setting}")

    async def _reset_all_member_attacktimes(self) -> None:
        for clan in self._clans.values():
            clan.ResetMemberAttacktimes()
            try:
                await clan.ResetMemberAttacktimesInDatabase()
            except Exception as exc:
                print(f"attacktime のリセットに失敗しました: {clan.clan_id}: {exc}")
            if clan.guild is not None:
                await clan.OnMessageHandled(clan.guild)

    async def _broadcast_notice(self, text: str) -> None:
        for clan in self._clans.values():
            await clan.SendNotice(text)

    async def _reset_all_bosslaps(self) -> None:
        for clan in self._clans.values():
            try:
                await clan.ResetBosslaps()
            except Exception as exc:
                print(f"bosslaps のリセットに失敗しました: {clan.clan_id}: {exc}")
            if clan.guild is not None:
                await clan.OnMessageHandled(clan.guild)

    async def _on_minute_tick(
        self,
        last_run: datetime.datetime,
        now: datetime.datetime,
    ) -> None:
        now = constants.as_jst(now)
        today_five = constants.scheduled_datetime(now.date(), 5, 0)
        if constants.crossed_scheduled_time(last_run, today_five, now):
            try:
                await self._reload_clanbattle_setting()
            except Exception as exc:
                print(f"setting_clanbattle の再読み込みに失敗しました: {exc}")
            await self._reset_all_member_attacktimes()

        start_date = self._setting_date(self.clanbattle_setting, "startDate")
        end_date = self._setting_date(self.clanbattle_setting, "endDate")

        if start_date is not None:
            eve_five = constants.scheduled_datetime(
                start_date - datetime.timedelta(days=1), 5, 0
            )
            start_five = constants.scheduled_datetime(start_date, 5, 0)
            if constants.crossed_scheduled_time(last_run, eve_five, now):
                await self._broadcast_notice(constants.CLANBATTLE_EVE_MESSAGE)
                await self._reset_all_bosslaps()
            if constants.crossed_scheduled_time(last_run, start_five, now):
                await self._broadcast_notice(constants.CLANBATTLE_START_MESSAGE)
                await self._reset_all_bosslaps()

        if end_date is not None:
            last_day_five = constants.scheduled_datetime(end_date, 5, 0)
            end_midnight = constants.scheduled_datetime(
                end_date + datetime.timedelta(days=1), 0, 0
            )
            if constants.crossed_scheduled_time(last_run, last_day_five, now):
                await self._broadcast_notice(constants.CLANBATTLE_LAST_DAY_MESSAGE)
            if constants.crossed_scheduled_time(last_run, end_midnight, now):
                await self._broadcast_notice(constants.CLANBATTLE_END_MESSAGE)

    def run(self) -> None:
        self.client.run(self.token)