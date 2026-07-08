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
        return await self._ack(message, "Attack", member, opt)

    async def ContinuesAttack(self, message: discord.Message, member: discord.Member, opt: str) -> bool:
        return await self._ack(message, "ContinuesAttack", member, opt)
