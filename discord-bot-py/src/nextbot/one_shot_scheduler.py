from __future__ import annotations

import asyncio
import datetime
from collections.abc import Awaitable, Callable


TimestampCallback = Callable[[], Awaitable[None]]


def parse_scheduled_time(value: str) -> datetime.time:
    text = value.strip()
    if not text:
        raise RuntimeError("NEXTBOT_RUN_AT が空です")

    formats = (
        "%H:%M:%S",
        "%H:%M",
    )

    for fmt in formats:
        try:
            parsed = datetime.datetime.strptime(text, fmt)
            return parsed.time()
        except ValueError:
            continue

    raise RuntimeError(
        "NEXTBOT_RUN_AT の形式が不正です。例: 21:30 または 21:30:00"
    )


class OneShotScheduler:
    def __init__(
        self,
        run_at: datetime.time,
        callback: TimestampCallback,
        logger: Callable[[str], None] = print,
    ) -> None:
        self.run_at = run_at
        self.callback = callback
        self.logger = logger
        self._task: asyncio.Task[None] | None = None

    def start(self) -> asyncio.Task[None]:
        if self._task is None:
            self._task = asyncio.create_task(self._run())
        return self._task

    def _next_run_at(self, now: datetime.datetime) -> datetime.datetime:
        candidate = datetime.datetime.combine(now.date(), self.run_at)
        if candidate <= now:
            candidate += datetime.timedelta(days=1)
        return candidate

    async def _run(self) -> None:
        while True:
            now = datetime.datetime.now()
            next_run_at = self._next_run_at(now)
            wait_seconds = (next_run_at - now).total_seconds()
            if wait_seconds > 0:
                await asyncio.sleep(wait_seconds)

            await self.callback()
            self.logger(
                "daily schedule executed " + datetime.datetime.now().strftime("%Y/%m/%d %H:%M:%S")
            )
