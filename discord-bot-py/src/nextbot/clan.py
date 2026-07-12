from __future__ import annotations

import discord

from .message_router import MessageRouter


class Clan(MessageRouter):
    def __init__(self, input_channel_name: str = "凸報告") -> None:
        super().__init__(
            input_channel_name,
            [
                (["attack", "a", "凸", "あ"], self.Attack),
                (["c", "持"], self.ContinuesAttack),
            ],
        )
        

    async def _ack(self, message: discord.Message, title: str, member: discord.Member, opt: str) -> bool:
        response = f"{member.display_name} の {title} を受け付けました"
        if opt:
            response = f"{response}: {opt}"

        try:
            await message.reply(response, mention_author=False)
        except (discord.Forbidden, discord.HTTPException):
            print(response)

        return True

    

    async def Attack(self, message: discord.Message, member: discord.Member, opt: str) -> bool:
        cmember = self.GetMember(message.author)

        try:
            num = int(opt)
            bidx = num - 1 if num < 10 else num // 10 - 1
            sortie = -1 if num < 10 else num % 10 - 1

            if bidx < 0 or BOSSNUMBER <= bidx or MAX_SORITE <= sortie:
                raise ValueError
        except ValueError:
            self.TemporaryMessage(message.channel, '「凸5」のように発言してください')
            return False

        error = await self.AttackCheck(message, member, bidx)
        if error:
            return False

        if sortie == -1:
            if member.FirstSoriteNum() == 0:
                self.TemporaryMessage(message.channel, '新規凸がありません')
                return False
            sortie = member.SortieCount()
            overtime = 0
        else:
            overtime = member.attacktime[sortie]
            if overtime is None or overtime == 0:
                self.TemporaryMessage(message.channel, '持ち越しではありません')
                return False

        boss = self.bosscount[bidx] * BOSSNUMBER + bidx

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
