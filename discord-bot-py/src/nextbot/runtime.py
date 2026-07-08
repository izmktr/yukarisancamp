from __future__ import annotations

import datetime

import discord

from .clan import Clan
from .one_shot_scheduler import OneShotScheduler, parse_scheduled_time


class NextBotApp:
    def __init__(
        self,
        token: str,
        input_channel_name: str = "凸報告",
        scheduled_run_at: str | None = None,
    ) -> None:
        intents = discord.Intents.default()
        intents.message_content = True

        self.client = discord.Client(intents=intents)
        self.token = token
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