from __future__ import annotations

# pyright: reportUnusedFunction=false

import asyncio
import datetime
import glob
import os
from pathlib import Path
from typing import Any, Callable, cast

import discord

from bot.clanbattle_setting import ClanBattleSetting
from bot.supabase import ClanBattleSettingEvent, SupabaseClient

from . import clan as clan_module
from . import shared
from .clan import Clan
from .global_strage import GlobalStrage

shared_any = cast(Any, shared)
ERRFILE: str = cast(str, shared_any.ERRFILE)
outlog: Callable[[str, Any], None] = cast(Callable[[str, Any], None], shared_any.Outlog)
clanhash: dict[int, Clan] = cast(dict[int, Clan], shared_any.clanhash)


class LegacyDiscordBotApp:
    def __init__(
        self,
        token: str,
        clanbattle_setting: ClanBattleSetting | None = None,
        supabase_client: SupabaseClient | None = None,
    ) -> None:
        intents = discord.Intents.default()
        intents.typing = False
        intents.members = True
        intents.message_content = True
        self.client = discord.Client(intents=intents)
        self.token = token
        self.clanbattle_setting = clanbattle_setting
        self.supabase_client = supabase_client
        self.clanbattle_watch_task: asyncio.Task[None] | None = None
        clan_module.client = self.client
        self._register_events()

    async def on_clanbattle_setting_changed(
        self,
        clanbattle_setting: ClanBattleSetting,
        event: ClanBattleSettingEvent,
    ) -> None:
        previous_yearmonth = None if self.clanbattle_setting is None else self.clanbattle_setting.yearmonth
        self.clanbattle_setting = clanbattle_setting
        print(
            'setting_clanbattle changed '
            f"{previous_yearmonth} -> {clanbattle_setting.yearmonth} "
            f"{clanbattle_setting.startDate} - {clanbattle_setting.endDate} "
            f"event_id={event.id} "
            f"source={event.source}"
        )

    def get_clan(self, guild: discord.Guild, message: discord.Message) -> Clan:
        clan = clanhash.get(guild.id)
        if clan is None:
            clan = Clan(message.channel.id)
            clanhash[guild.id] = clan
        any_clan = cast(Any, clan)
        if any_clan.guild is None:
            any_clan.guild = guild
        return clan

    async def output(self, clan: Clan, message: str) -> None:
        any_clan = cast(Any, clan)
        any_clan.SetOutputChannel()
        if any_clan.outputchannel is not None:
            if any_clan.outputlock == 1:
                return
            try:
                while any_clan.outputlock != 0:
                    await asyncio.sleep(1)

                if any_clan.lastmessage is not None:
                    any_clan.outputlock = 1
                    try:
                        await any_clan.lastmessage.delete()
                    except (discord.errors.NotFound, discord.errors.Forbidden):
                        pass
                    any_clan.lastmessage = None

                try:
                    any_clan.outputlock = 2
                    any_clan.lastmessage = await any_clan.outputchannel.send(message)
                except discord.errors.Forbidden:
                    any_clan.outputchannel = None
            finally:
                any_clan.outputlock = 0

    def load_saved_clans(self) -> None:
        files = glob.glob(str(Path(__file__).resolve().parent.parent / 'clandata' / '*.json'))
        for file in files:
            clanid = int(os.path.splitext(os.path.basename(file))[0])
            if clanid != 0:
                clan = Clan.Load(clanid)
                clanhash[clanid] = clan

    def _register_events(self) -> None:
        @self.client.event
        async def on_ready() -> None:
            print('ログインしました ' + datetime.datetime.now().strftime('%Y/%m/%d %H:%M:%S'))
            if self.clanbattle_setting is not None:
                print(
                    'setting_clanbattle loaded '
                    f"{self.clanbattle_setting.yearmonth} "
                    f"{self.clanbattle_setting.startDate} - {self.clanbattle_setting.endDate}"
                )
            if (
                self.supabase_client is not None
                and self.clanbattle_setting is not None
                and self.clanbattle_watch_task is None
            ):
                self.clanbattle_watch_task = asyncio.create_task(
                    self.supabase_client.watch_clanbattle_setting_events(
                        self.clanbattle_setting,
                        self.on_clanbattle_setting_changed,
                    )
                )
            outlog(ERRFILE, 'login.')
            for guildid, clan in clanhash.items():
                any_clan = cast(Any, clan)
                if any_clan.guild is None:
                    matchguild = [g for g in self.client.guilds if g.id == guildid]
                    if len(matchguild) == 1:
                        any_clan.SetGuild(matchguild[0])
                    else:
                        print(f'[{guildid}] not found')

        @self.client.event
        async def on_message(message: discord.Message) -> None:
            if message.author.bot:
                return
            if message.guild is None:
                return
            if message.channel.type == discord.ChannelType.text:
                clan = self.get_clan(message.guild, message)
                any_clan = cast(Any, clan)
                result = await any_clan.on_message(message)
                if result:
                    any_clan.Save(message.guild.id)
                    await self.output(clan, any_clan.Status())

        @self.client.event
        async def on_raw_message_delete(payload: discord.RawMessageDeleteEvent) -> None:
            if payload.guild_id is None:
                return
            clan = clanhash.get(payload.guild_id)
            if clan is not None and cast(Any, clan).IsInput(payload.channel_id):
                any_clan = cast(Any, clan)
                result = await any_clan.on_raw_message_delete(payload)
                if result:
                    any_clan.Save(payload.guild_id)
                    await self.output(clan, any_clan.Status())

        @self.client.event
        async def on_raw_reaction_add(payload: discord.RawReactionActionEvent) -> None:
            if payload.guild_id is None:
                return
            clan = clanhash.get(payload.guild_id)
            if clan is not None:
                any_clan = cast(Any, clan)
                result = await any_clan.on_raw_reaction_add(payload)
                if result:
                    any_clan.Save(payload.guild_id)
                    await self.output(clan, any_clan.Status())

        @self.client.event
        async def on_raw_reaction_remove(payload: discord.RawReactionActionEvent) -> None:
            if payload.guild_id is None:
                return
            clan = clanhash.get(payload.guild_id)
            if clan is not None:
                any_clan = cast(Any, clan)
                result = await any_clan.on_raw_reaction_remove(payload)
                if result:
                    any_clan.Save(payload.guild_id)
                    await self.output(clan, any_clan.Status())

        @self.client.event
        async def on_member_remove(member: discord.Member) -> None:
            if member.bot:
                return
            clan = clanhash.get(member.guild.id)
            if clan is None:
                return
            any_clan = cast(Any, clan)
            if member.id in any_clan.members:
                del any_clan.members[member.id]
                any_clan.Save(member.guild.id)
                await self.output(clan, any_clan.Status())

        @self.client.event
        async def on_guild_join(guild: discord.Guild) -> None:
            outlog(ERRFILE, 'on_guild_join. %s' % guild.name)

        @self.client.event
        async def on_guild_remove(guild: discord.Guild) -> None:
            if guild.id in clanhash:
                del clanhash[guild.id]
                try:
                    os.remove(str(Path(__file__).resolve().parent.parent / 'clandata' / f'{guild.id}.json'))
                except FileNotFoundError:
                    pass

    def run(self) -> None:
        self.load_saved_clans()
        try:
            GlobalStrage.Load()
        except Exception:
            pass
        self.client.run(self.token)
