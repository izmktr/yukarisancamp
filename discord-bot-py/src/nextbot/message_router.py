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

    def _strip_leading_mention(self, content: str, bot_user: discord.ClientUser | None) -> str:
        if bot_user is None:
            return content

        for mention in (f"<@{bot_user.id}>", f"<@!{bot_user.id}>"):
            if content.startswith(mention):
                return content[len(mention) :].lstrip()

        return content

    def _has_leading_bot_mention(self, content: str, bot_user: discord.ClientUser | None) -> bool:
        if bot_user is None:
            return False

        return any(content.startswith(mention) for mention in (f"<@{bot_user.id}>", f"<@!{bot_user.id}>") )

    def _is_target_message(self, message: discord.Message, bot_user: discord.ClientUser | None) -> bool:
        channel_name = getattr(message.channel, "name", None)
        if channel_name == self.input_channel_name:
            return True

        return self._has_leading_bot_mention(message.content.strip(), bot_user)

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

        content = message.content.strip()
        if bot_user is not None:
            content = self._strip_leading_mention(content, bot_user)

        content = content.lstrip()
        if not content:
            return False

        matched = self._match_handler(content)
        if matched is None:
            return False

        handler, prefix = matched
        opt = content[len(prefix) :].lstrip()
        return await handler(message, member, opt)