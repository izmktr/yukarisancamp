from __future__ import annotations
import asyncio
import random
import re

import discord

from .message_router import MessageRouter
# 推奨: モジュールごと import
from . import constants

from .clan_member import ClanMember

class MessageReaction():
    def __init__(self, member : ClanMember) -> None:
        self.member = member
        self.addreaction = None
        self.removereaction = None
        self.deletereaction = None


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
                (["tl"], self.TimelineConvert),
                (['dice', 'サイコロ', 'ダイス'], self.Dice),
                (['yukalink'], self.Yukalink),
            ],
        )
        self.members: dict[int, ClanMember] = {}
        self.bosslaps: list[int] = [0] * constants.BOSSNUMBER             # ボスの進行具合

        self.dicehistory = [10, 30, 50, 70, 90]                 # ダイスが重複した値が出ないようにしたフラグ

        self.stampcheck :dict[str, int] = {}                    # スタンプの二重押し防止
        self.messagereaction : dict[int, MessageReaction] = {}
                                                                # スタンプを押したときの反応用


    async def _ack(self, message: discord.Message, title: str, member: discord.Member, opt: str) -> bool:
        response = f"{member.display_name} の {title} を受け付けました"
        if opt:
            response = f"{response}: {opt}"

        try:
            await message.reply(response, mention_author=False)
        except (discord.Forbidden, discord.HTTPException):
            print(response)

        return True

    def AddStamp(self, messageid : str):
        if messageid in self.stampcheck:
            self.stampcheck[messageid] += 1
        else:
            self.stampcheck[messageid] = 1
        return self.stampcheck[messageid]

    def RemoveStamp(self, messageid : str):
        if messageid in self.stampcheck:
            self.stampcheck['messageid'] -= 1
        else:
            self.stampcheck['messageid'] = 0
        return self.stampcheck['messageid']

    def emojiindex(self, emojistr : str) -> int | None:
        for idx, emoji in enumerate(self.emojis):
            if emoji == emojistr:
                return idx
        for idx, emoji in enumerate(self.emojisoverkill):
            if emoji == emojistr:
                return idx
        return None


    def CreateAttackReaction(self, atmember : ClanMember, message, boss : int, sortie : int, overtime : int):
        react = MessageReaction(atmember)
        async def addreaction(member : ClanMember, payload : discord.RawReactionActionEvent) -> bool:
            if member != atmember:
                return False

            idx = self.emojiindex(payload.emoji.name)
            if idx is None:
                return False

            v = self.AddStamp(payload.message_id)
            if v != 1:
                Outlog(ERRFILE, "self.AddStamp" + " " + v)
                return False

            if idx == 0:
                if self.checkStampWarning(boss):
                    self.TemporaryMessage(self.inputchannel, '%s ボス未討伐の報告で間違いないですか？' % member.mention)

                member.Finish(payload.message_id, False, 0.5 if member.IsOverkill() else 1.0)
                reboss = RESERVELAP * BOSSNUMBER + boss % BOSSNUMBER
                self.RemoveReserve(lambda m: m.member == member and m.boss in [boss, reboss])

                await self.damagecontrol[boss % BOSSNUMBER].Injure(member)
                await self.damagecontrol[boss % BOSSNUMBER].SendResult()
            
            if 1 <= idx and idx <= 8:
                if 0 < overtime:
                    member.Finish(payload.message_id, True, 0.5)
                else:
                    member.Overkill(payload.message_id, (idx + 1) * 10)

                bidx = boss % BOSSNUMBER
                await self.DamageControlDefeat(boss)

                reboss = RESERVELAP * BOSSNUMBER + bidx
                self.RemoveReserve(lambda m: m.member == member and m.boss == reboss)

                newlap = self.DefeatBoss(bidx)

                mention = self.CreateNotice(newlap, bidx)

                if mention is not None:
                    await message.channel.send(mention)

                for m in self.members.values():
                    if m.IsAttack() and m.boss == boss:
                        m.reportlimit = datetime.datetime.now() + datetime.timedelta(minutes = 5)
            
            if idx == 9:
                member.Cancel()
                await self.damagecontrol[boss % BOSSNUMBER].Remove(member)
                await self.damagecontrol[boss % BOSSNUMBER].SendResult()

            await self.RemoveReaction(message, 0 < overtime, message.guild.me)
            return True

        react.addreaction = addreaction

        async def removereaction(member : ClanMember, payload):
            if member != atmember:
                return False

            idx = self.emojiindex(payload.emoji.name)
            if idx is None:
                return False

            v = self.RemoveStamp(payload.message_id)
            if v != 0:
                return False

            if member.attackmessage is not None and member.attackmessage.id == payload.message_id:
                if idx == 9:
                    member.Attack(boss, sortie)
                    await self.AddReaction(message, 0 < overtime)
                    return True

                data = member.Revert(payload.message_id)
                if data is not None:
                    member.Attack(data.boss, data.sortie)
                    if data.defeat:
                        bossidx = data.boss % BOSSNUMBER
                        self.UndefeatBoss(bossidx)
                        self.TemporaryMessage(self.inputchannel, '巻き戻しました\nボスが違うときは、defeat/undefeat/setbossで調整してください')
                    
                    await self.AddReaction(message, 0 < overtime)
                else:
                    self.TemporaryMessage(self.inputchannel, '巻き戻しに失敗しました')
                return True

        react.removereaction = removereaction

        async def deletereaction(payload):
            atmember.Revert(payload.message_id)
            if atmember.attackmessage.id == payload.message_id:
                atmember.Cancel()
            return True

        react.deletereaction = deletereaction

        return react

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

    def IsAttackableBoss(self, bidx : int):
        if not constants.is_valid_boss(bidx):
            return False

        minlap = min(self.bosslaps)
        if minlap + 1 < self.bosslaps[bidx]:
            return False

        return True

    async def AttackCheck(self, message : discord.Message, member : ClanMember, bidx : int):
        if self.CheckInputChannel(message):
            self.TemporaryMessage(message.channel, '%s のチャンネルで発言してください' % constants.INPUT_CHANNEL) # type: ignore
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

        boss = self.bosslaps[bidx] * constants.BOSSNUMBER + bidx

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

    async def TimelineConvert(self, message: discord.Message, member: discord.Member, opt: str) -> bool:
        lines = opt.splitlines(True)

        if not lines:
            self.TemporaryMessage(message.channel, '持ち越し時間を入力してください')
            return False

        tm = re.match(r'\d+', lines[0])
        if tm is None:
            self.TemporaryMessage(message.channel, '持ち越し時間を入力してください')
            return False

        overtime = int(tm.group())
        result = '持ち越し時間:%d秒\n' % overtime

        lines = lines[1:]

        for line in lines:
            offset = 0
            while True:
                m = re.search(r'(\d+)([:：])(\d+)', line[offset:])
                if m is None:
                    result += line[offset:]
                    break

                x = max(int(m.group(1)) * 60 + int(m.group(3)) - (90 - overtime), 0)
                if 0 < offset or 0 < x:
                    result += line[offset:offset + m.start()] + '%d:%02d' % (x // 60, x % 60)
                    offset += m.end()
                else:
                    break
        
        await message.channel.send('```' + result + '```')

        return False

    async def Dice(self, message: discord.Message, member: discord.Member, opt: str) -> bool:

        while True:
            rndstar = int(random.random() * 100 + 1)
            if rndstar not in self.dicehistory:
                if len(self.dicehistory) >= 5:
                    self.dicehistory = self.dicehistory[1:]
                self.dicehistory.append(rndstar)
                break

        await message.channel.send('%s %s %d' % (message.author.display_name, chr(int(0x1F3B2)), rndstar))

        return True

    async def Yukalink(self, message: discord.Message, member: discord.Member, opt: str) -> bool:

        if message.guild is None:
            return False
        text = ','.join([opt.strip(), str(message.guild.id), str(message.author.id)])

        # supabaseにクラン情報を登録

        # supabaseに自分自身の情報を登録

        self.TemporaryMessage(message.channel, text)
        return False

    async def OnReactionAdd(self, reaction: discord.Reaction, user: discord.User) -> bool:
        if user.bot:
            return False

        if reaction.message.id not in self.messagereaction:
            return False

        member = self.GetMember(user)
        if member.attackmessage is None or member.attackmessage.id != reaction.message.id:
            return False

        if reaction.emoji == self.taskkillmark:
            member.taskkill = 1
            await reaction.message.remove_reaction(reaction.emoji, user)
            return True

        if reaction.emoji not in self.emojis:
            return False

        idx = self.emojis.index(reaction.emoji)
        if idx == 0:
            idx = 10

        boss = member.attackboss
        sortie = member.attacksortie
        overtime = member.attacktime[sortie]

        if idx == 10 and overtime == 0:
            await reaction.message.remove_reaction(reaction.emoji, user)
            return True

        if idx != 10 and overtime != 0:
            await reaction.message.remove_reaction(reaction.emoji, user)
            return True

        await self.AddReaction(reaction.message, idx < 10)

        return True

    async def OnReactionRemove(self, reaction: discord.Reaction, user: discord.User) -> bool:
        if user.bot:
            return False

        if reaction.message.id not in self.messagereaction:
            return False

        member = self.GetMember(user)
        if member.attackmessage is None or member.attackmessage.id != reaction.message.id:
            return False

        if reaction.emoji == self.taskkillmark:
            member.taskkill = 0
            return True

        if reaction.emoji not in self.emojis:
            return False

        idx = self.emojis.index(reaction.emoji)
        if idx == 0:
            idx = 10

        boss = member.attackboss
        sortie = member.attacksortie
        overtime = member.attacktime[sortie]

        if idx == 10 and overtime == 0:
            return True

        if idx != 10 and overtime != 0:
            return True

        await self.AddReaction(reaction.message, idx < 10)

        return True