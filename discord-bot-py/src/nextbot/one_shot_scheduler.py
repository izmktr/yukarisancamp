from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable


TimestampCallback = Callable[[], Awaitable[None]]


class MinuteScheduler:
    def __init__(
        self,
        callback: TimestampCallback,
        interval_seconds: float = 60,
        logger: Callable[[str], None] = print,
    ) -> None:
        self.callback = callback
        self.interval_seconds = interval_seconds
        self.logger = logger
        self._task: asyncio.Task[None] | None = None

    def start(self) -> asyncio.Task[None]:
        if self._task is None:
            self._task = asyncio.create_task(self._run())
        return self._task

    async def _run(self) -> None:
        while True:
            await asyncio.sleep(self.interval_seconds)
            try:
                await self.callback()
            except Exception as exc:
                self.logger("minute schedule failed: " + str(exc))
