from __future__ import annotations

import asyncio
import datetime
from typing import Any

import discord

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
        self._register_events()

    def _get_clan(self, guild: discord.Guild) -> Clan:
        clan = self._clans.get(guild.id)
        if clan is None:
            clan = Clan(self.input_channel_name)
            self._clans[guild.id] = clan
        return clan

    def _register_events(self) -> None:
        @self.client.event
        async def on_ready() -> None:
            print("ログインしました " + datetime.datetime.now().strftime("%Y/%m/%d %H:%M:%S"))
            guild_names = [guild.name for guild in self.client.guilds]
            print("参加サーバ一覧: " + (", ".join(guild_names) if guild_names else "なし"))

            # Supabase にクラン情報を登録
            for guild in self.client.guilds:
                registered = await asyncio.to_thread(
                    self.supabase.register_clan_if_missing,
                    guild.id,
                    guild.name,
                )
                if registered:
                    print(f"Supabaseにクランを登録しました: {guild.name} ({guild.id})")

            # Supabase から setting_clanbattle を取得
            if self.clanbattle_setting is None:
                self.clanbattle_setting = await asyncio.to_thread(self.supabase.get_clanbattle_setting)
                print(f"setting_clanbattle(id=0): {self.clanbattle_setting}")

            

            # スケジュールされた実行時間が設定されている場合、OneShotScheduler を開始
            if self.scheduled_run_at and self._one_shot_scheduler is None:
                run_at = parse_scheduled_time(self.scheduled_run_at)
                self._one_shot_scheduler = OneShotScheduler(run_at, self._run_one_shot_callback)
                self._one_shot_scheduler.start()
                print("daily schedule enabled at " + run_at.strftime("%H:%M:%S"))
            

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