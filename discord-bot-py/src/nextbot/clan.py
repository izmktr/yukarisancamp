from __future__ import annotations
import asyncio

import discord

from .message_router import MessageRouter
# 推奨: モジュールごと import
from . import constants

from .clan_member import ClanMember

class Clan(MessageRouter):
    numbermarks = [
        "\N{DIGIT ZERO}\N{COMBINING ENCLOSING KEYCAP}", # type: ignore
        "\N{DIGIT ONE}\N{COMBINING ENCLOSING KEYCAP}", # type: ignore
        "\N{DIGIT TWO}\N{COMBINING ENCLOSING KEYCAP}", # type: ignore
        "\N{DIGIT THREE}\N{COMBINING ENCLOSING KEYCAP}", # type: ignore
        "\N{DIGIT FOUR}\N{COMBINING ENCLOSING KEYCAP}", # type: ignore
        "\N{DIGIT FIVE}\N{COMBINING ENCLOSING KEYCAP}", # type: ignore
        "\N{DIGIT SIX}\N{COMBINING ENCLOSING KEYCAP}", # type: ignore
        "\N{DIGIT SEVEN}\N{COMBINING ENCLOSING KEYCAP}", # type: ignore
        "\N{DIGIT EIGHT}\N{COMBINING ENCLOSING KEYCAP}", # type: ignore
        "\N{DIGIT NINE}\N{COMBINING ENCLOSING KEYCAP}", # type: ignore
    ]

    emojis = [
        u"\u2705",
        "\N{DIGIT TWO}\N{COMBINING ENCLOSING KEYCAP}", # type: ignore
        "\N{DIGIT THREE}\N{COMBINING ENCLOSING KEYCAP}", # type: ignore
        "\N{DIGIT FOUR}\N{COMBINING ENCLOSING KEYCAP}", # type: ignore
        "\N{DIGIT FIVE}\N{COMBINING ENCLOSING KEYCAP}", # type: ignore
        "\N{DIGIT SIX}\N{COMBINING ENCLOSING KEYCAP}", # type: ignore
        "\N{DIGIT SEVEN}\N{COMBINING ENCLOSING KEYCAP}", # type: ignore
        "\N{DIGIT EIGHT}\N{COMBINING ENCLOSING KEYCAP}", # type: ignore
        "\N{DIGIT NINE}\N{COMBINING ENCLOSING KEYCAP}", # type: ignore
        u"\u274C",
    ]

    emojisoverkill = [
        u"\u2705",
        "\N{DIGIT ZERO}\N{COMBINING ENCLOSING KEYCAP}", # type: ignore
        u"\u274C",
    ]
    taskkillmark = u"\u2757"

    def __init__(self, input_channel_name: str = "凸報告") -> None:
        super().__init__(
            input_channel_name,
            [
                (["attack", "a", "凸", "あ"], self.Attack),
                (["c", "持"], self.ContinuesAttack),
            ],
        )
        self.members: dict[int, ClanMember] = {}
        

    async def _ack(self, message: discord.Message, title: str, member: discord.Member, opt: str) -> bool:
        response = f"{member.display_name} の {title} を受け付けました"
        if opt:
            response = f"{response}: {opt}"

        try:
            await message.reply(response, mention_author=False)
        except (discord.Forbidden, discord.HTTPException):
            print(response)

        return True

    @staticmethod
    async def SendMessage(channel : discord.abc.Messageable, message : str):
        try:
            post = await channel.send(message)
            await asyncio.sleep(60)
            await post.delete()
        except (discord.errors.NotFound, discord.errors.Forbidden):
            pass

    def TemporaryMessage(self, channel: discord.abc.Messageable, message : str):
        asyncio.ensure_future(self.SendMessage(channel, message))

    def CheckInputChannel(self, message : discord.Message):
        if self.input_channel_name != "" and message.channel.name != self.input_channel_name:
            return True
            
        return False

    def CheckNotAdministrator(self, message : discord.Message):
        if message.author.guild_permissions.administrator:
            return False
        return True

    def CheckNotMasterAdministrator(self, clan : ClanMember, message : discord.Message):
        return False


    async def AttackCheck(self, message : discord.Message, member : ClanMember, bidx : int):
        if self.CheckInputChannel(message):
            self.TemporaryMessage(message.channel, '%s のチャンネルで発言してください' % INPUT_CHANNEL) # type: ignore
            return True

        if not self.IsAttackableBoss(bidx):
            self.TemporaryMessage(message.channel, '攻撃できないボスです')
            return True

        if member.IsAttack():
            self.TemporaryMessage(message.channel, 'すでに凸があります 前の凸を無効にするにはcancelと入力してください')
            return True

        return False

    def GetMember(self, user : discord.User) -> ClanMember:
        if user.id not in self.members:
            self.members[user.id] = ClanMember(user.id)
            self.members[user.id].name = user.name
            self.members[user.id].mention = user.mention

        return self.members[user.id]

    async def Attack(self, message: discord.Message, member: discord.Member, opt: str) -> bool:
        cmember = self.GetMember(message.author)

        try:
            num = int(opt)
            bidx = num if num < 10 else num // 10
            sortie = 0 if num < 10 else num % 10

            if not constants.is_valid_boss(bidx) or not constants.is_valid_sortie(sortie):
                raise ValueError
        except ValueError:
            self.TemporaryMessage(message.channel, '「凸5」 のように発言してください')
            return False

        error = await self.AttackCheck(message, cmember, bidx)
        if error:
            return False

        if sortie == -1:
            if cmember.FirstSoriteNum() == 0:
                self.TemporaryMessage(message.channel, '新規凸がありません')
                return False
            sortie = cmember.SortieCount()
            overtime = 0
        else:
            overtime = cmember.attacktime[sortie]
            if overtime is None or overtime == 0:
                self.TemporaryMessage(message.channel, '持ち越しではありません')
                return False

        boss = self.bosscount[bidx] * constants.BOSSNUMBER + bidx

        member.Attack(boss, sortie)
        if member.attackmessage is not None:
            self.messagereaction.pop(member.attackmessage.id, None)
        member.attackmessage = message

        self.messagereaction[message.id] = self.CreateAttackReaction(member, message, boss, sortie, overtime)

        if member.taskkill != 0:
            await message.add_reaction(self.taskkillmark)

        await self.AddReaction(message, 0 < overtime)

        return True

    async def ContinuesAttack(self, message: discord.Message, member: discord.Member, opt: str) -> bool:
        return await self._ack(message, "ContinuesAttack", member, opt)
