from __future__ import annotations

from collections.abc import Awaitable, Callable

import discord


Handler = Callable[[discord.Message, discord.Member, str], Awaitable[bool]]


class MessageRouter:
    def __init__(self, input_channel_name: str, func_list: list[tuple[list[str], Handler]]) -> None:
        self.input_channel_name = input_channel_name
        self.funcList = func_list
        self._ordered_funcList: list[tuple[list[str], Handler]] = sorted(
            ((sorted(prefixes, key=len, reverse=True), handler) for prefixes, handler in self.funcList),
            key=lambda item: len(item[0][0]),
            reverse=True,
        )

    async def OnMessageHandled(self, guild: discord.Guild) -> None:
        raise NotImplementedError

    async def OnReactionAdd(self, guild: discord.Guild, user: discord.User) -> None:
        raise NotImplementedError

    async def OnReactionRemove(self, guild: discord.Guild, user: discord.User) -> None:
        raise NotImplementedError

    def _strip_bot_mention(
        self,
        message: discord.Message,
        bot_user: discord.ClientUser | None,
    ) -> str:
        content = message.content
        if bot_user is None:
            return content

        for mention in (f"<@{bot_user.id}>", f"<@!{bot_user.id}>"):
            content = content.replace(mention, "")

        return content.strip()

    def _has_bot_mention(self, message: discord.Message, bot_user: discord.ClientUser | None) -> bool:
        # bot を含むロールへのメンションは bot 宛てとみなさない
        if bot_user is None:
            return False
        return bot_user.id in message.raw_mentions

    def _is_target_message(self, message: discord.Message, bot_user: discord.ClientUser | None) -> bool:
        channel_name = getattr(message.channel, "name", None)
        if channel_name == self.input_channel_name:
            return True

        return self._has_bot_mention(message, bot_user)

    def _match_handler(self, content: str) -> tuple[Handler, str] | None:
        for prefixes, handler in self._ordered_funcList:
            for prefix in prefixes:
                if content.startswith(prefix):
                    return handler, prefix

        return None

    async def on_message(
        self,
        message: discord.Message,
        member: discord.Member,
        bot_user: discord.ClientUser | None,
    ) -> bool:
        if not self._is_target_message(message, bot_user):
            return False

        content = self._strip_bot_mention(message, bot_user)

        content = content.lstrip()
        if not content:
            return False

        matched = self._match_handler(content)
        if matched is None:
            return False

        handler, prefix = matched
        opt = content[len(prefix) :].lstrip()
        result = await handler(message, member, opt)

        if result and message.guild is not None:
            await self.OnMessageHandled(message.guild)

        return result

    async def on_reaction_add(
        self,
        reaction: discord.Reaction,
        user: discord.User,
        bot_user: discord.ClientUser | None,
    ) -> bool:
        if not self._is_target_message(reaction.message, bot_user):
            return False

        if reaction.message.guild is not None:
            await self.OnReactionAdd(reaction.message.guild, user)

        return True

    async def on_reaction_remove(
        self,
        reaction: discord.Reaction,
        user: discord.User,
        bot_user: discord.ClientUser | None,
    ) -> bool:
        if not self._is_target_message(reaction.message, bot_user):
            return False

        if reaction.message.guild is not None:
            await self.OnReactionRemove(reaction.message.guild, user)

        return True
    