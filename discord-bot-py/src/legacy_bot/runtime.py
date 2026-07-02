from __future__ import annotations

from pathlib import Path

import discord
from discord.ext import tasks

from bot.clanbattle_setting import ClanBattleSetting

from . import clan as clan_module
from .clan import Clan
from .global_strage import GlobalStrage
from .shared import *


class LegacyDiscordBotApp:
    def __init__(self, token: str, clanbattle_setting: ClanBattleSetting | None = None) -> None:
        intents = discord.Intents.default()
        intents.typing = False
        intents.members = True
        intents.message_content = True
        self.client = discord.Client(intents=intents)
        self.token = token
        self.clanbattle_setting = clanbattle_setting
        clan_module.client = self.client
        self._register_events()

    def get_clan(self, guild, message) -> Clan:
        global clanhash
        clan = clanhash.get(guild.id)
        if clan is None:
            clan = Clan(message.channel.id)
            clanhash[guild.id] = clan
        if clan.guild is None:
            clan.guild = guild
        return clan

    async def output(self, clan: Clan, message: str):
        clan.SetOutputChannel()
        if clan.outputchannel is not None:
            if clan.outputlock == 1:
                return
            try:
                while clan.outputlock != 0:
                    await asyncio.sleep(1)

                if clan.lastmessage is not None:
                    clan.outputlock = 1
                    try:
                        await clan.lastmessage.delete()
                    except (discord.errors.NotFound, discord.errors.Forbidden):
                        pass
                    clan.lastmessage = None

                try:
                    clan.outputlock = 2
                    clan.lastmessage = await clan.outputchannel.send(message)
                except discord.errors.Forbidden:
                    clan.outputchannel = None
            finally:
                clan.outputlock = 0

    def load_saved_clans(self) -> None:
        files = glob.glob(str(Path(__file__).resolve().parent.parent / 'clandata' / '*.json'))
        for file in files:
            clanid = int(os.path.splitext(os.path.basename(file))[0])
            if clanid != 0:
                clan = Clan.Load(clanid)
                clanhash[clanid] = clan

    def _register_events(self) -> None:
        @self.client.event
        async def on_ready():
            print('ログインしました ' + datetime.datetime.now().strftime('%Y/%m/%d %H:%M:%S'))
            if self.clanbattle_setting is not None:
                print(
                    'setting_clanbattle loaded '
                    f"{self.clanbattle_setting.yearmonth} "
                    f"{self.clanbattle_setting.startDate} - {self.clanbattle_setting.endDate}"
                )
            Outlog(ERRFILE, 'login.')
            for guildid, clan in clanhash.items():
                if clan.guild is None:
                    matchguild = [g for g in self.client.guilds if g.id == guildid]
                    if len(matchguild) == 1:
                        clan.SetGuild(matchguild[0])
                    else:
                        print(f'[{guildid}] not found')

        @self.client.event
        async def on_message(message):
            if message.author.bot:
                return
            if message.channel.type == discord.ChannelType.text:
                clan = self.get_clan(message.guild, message)
                result = await clan.on_message(message)
                if result:
                    clan.Save(message.guild.id)
                    await self.output(clan, clan.Status())

        @self.client.event
        async def on_raw_message_delete(payload):
            clan = clanhash.get(payload.guild_id)
            if clan is not None and clan.IsInput(payload.channel_id):
                result = await clan.on_raw_message_delete(payload)
                if result:
                    clan.Save(payload.guild_id)
                    await self.output(clan, clan.Status())

        @self.client.event
        async def on_raw_reaction_add(payload):
            clan = clanhash.get(payload.guild_id)
            if clan is not None:
                result = await clan.on_raw_reaction_add(payload)
                if result:
                    clan.Save(payload.guild_id)
                    await self.output(clan, clan.Status())

        @self.client.event
        async def on_raw_reaction_remove(payload):
            clan = clanhash.get(payload.guild_id)
            if clan is not None:
                result = await clan.on_raw_reaction_remove(payload)
                if result:
                    clan.Save(payload.guild_id)
                    await self.output(clan, clan.Status())

        @self.client.event
        async def on_member_remove(member):
            if member.bot:
                return
            clan = clanhash.get(member.guild.id)
            if clan is None:
                return
            if member.id in clan.members:
                del clan.members[member.id]
                clan.Save(member.guild.id)
                await self.output(clan, clan.Status())

        @self.client.event
        async def on_guild_join(guild):
            Outlog(ERRFILE, 'on_guild_join. %s' % guild.name)

        @self.client.event
        async def on_guild_remove(guild):
            global clanhash
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
