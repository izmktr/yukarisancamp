from __future__ import annotations

import asyncio
import inspect
import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any, cast
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .clanbattle_setting import ClanBattleSetting


@dataclass(frozen=True)
class ClanBattleSettingEvent:
    id: int
    yearmonth: str
    event_type: str
    source: str
    triggered_by: str | None
    created_at: datetime

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "ClanBattleSettingEvent":
        event_id = payload.get("id")
        yearmonth = payload.get("yearmonth")
        event_type = payload.get("event_type")
        source = payload.get("source")
        triggered_by = payload.get("triggered_by")
        created_at = payload.get("created_at")

        if not isinstance(event_id, int):
            raise RuntimeError("setting_clanbattle_events.id が不正です")
        if not isinstance(yearmonth, str) or len(yearmonth) != 6:
            raise RuntimeError("setting_clanbattle_events.yearmonth が不正です")
        if not isinstance(event_type, str) or not event_type:
            raise RuntimeError("setting_clanbattle_events.event_type が不正です")
        if not isinstance(source, str) or not source:
            raise RuntimeError("setting_clanbattle_events.source が不正です")
        if triggered_by is not None and not isinstance(triggered_by, str):
            raise RuntimeError("setting_clanbattle_events.triggered_by が不正です")
        if not isinstance(created_at, str):
            raise RuntimeError("setting_clanbattle_events.created_at が不正です")

        return cls(
            id=event_id,
            yearmonth=yearmonth,
            event_type=event_type,
            source=source,
            triggered_by=triggered_by,
            created_at=datetime.fromisoformat(created_at.replace("Z", "+00:00")),
        )


@dataclass(frozen=True)
class SupabaseClient:
    url: str
    secret_key: str

    def _fetch_rows(self, table: str, query: dict[str, str]) -> list[dict[str, Any]]:
        request = Request(
            url=f"{self.url.rstrip('/')}/rest/v1/{table}?{urlencode(query)}",
            headers={
                "apikey": self.secret_key,
                "Authorization": f"Bearer {self.secret_key}",
                "Accept": "application/json",
            },
            method="GET",
        )

        with urlopen(request) as response:
            payload = json.loads(response.read().decode("utf-8"))

        if not isinstance(payload, list):
            raise RuntimeError(f"{table} から不正なレスポンスを受信しました")

        rows = cast(list[dict[str, Any]], payload)
        return rows

    def _upsert_rows(self, table: str, rows: list[dict[str, Any]], on_conflict: str) -> None:
        request = Request(
            url=f"{self.url.rstrip('/')}/rest/v1/{table}?{urlencode({'on_conflict': on_conflict})}",
            headers={
                "apikey": self.secret_key,
                "Authorization": f"Bearer {self.secret_key}",
                "Accept": "application/json",
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates,return=minimal",
            },
            data=json.dumps(rows).encode("utf-8"),
            method="POST",
        )

        with urlopen(request):
            return

    def upsert_attack_history(self, row: dict[str, Any]) -> None:
        self._upsert_rows("attack_history", [row], "serial")

    def upsert_attack_histories(self, rows: list[dict[str, Any]]) -> None:
        if not rows:
            return
        self._upsert_rows("attack_history", rows, "serial")

    def fetch_clanbattle_setting(self) -> ClanBattleSetting:
        rows = self._fetch_rows(
            "setting_clanbattle",
            {
                "select": "yearmonth,bossname,bossHp,startDate,endDate",
                "order": "yearmonth.desc",
                "limit": "1",
            },
        )

        if not rows:
            raise RuntimeError("setting_clanbattle から有効な設定を取得できませんでした")

        return ClanBattleSetting.from_payload(rows[0])

    def fetch_latest_clanbattle_setting_event(self) -> ClanBattleSettingEvent | None:
        rows = self._fetch_rows(
            "setting_clanbattle_events",
            {
                "select": "id,yearmonth,event_type,source,triggered_by,created_at",
                "order": "id.desc",
                "limit": "1",
            },
        )

        if not rows:
            return None

        return ClanBattleSettingEvent.from_payload(rows[0])

    async def watch_clanbattle_setting_events(
        self,
        current_setting: ClanBattleSetting,
        callback: Callable[[ClanBattleSetting, ClanBattleSettingEvent], None | Awaitable[None]],
        poll_interval_seconds: float = 5.0,
    ) -> None:
        latest_setting = current_setting
        latest_event = await asyncio.to_thread(self.fetch_latest_clanbattle_setting_event)
        latest_event_id = None if latest_event is None else latest_event.id

        while True:
            await asyncio.sleep(poll_interval_seconds)

            try:
                next_event = await asyncio.to_thread(self.fetch_latest_clanbattle_setting_event)
            except Exception as exc:
                print(f"setting_clanbattle_events watch failed: {exc}")
                continue

            if next_event is None or next_event.id == latest_event_id:
                continue

            latest_event_id = next_event.id

            try:
                next_setting = await asyncio.to_thread(self.fetch_clanbattle_setting)
            except Exception as exc:
                print(f"setting_clanbattle reload failed: {exc}")
                continue

            if next_setting == latest_setting:
                continue

            latest_setting = next_setting
            result = callback(next_setting, next_event)
            if inspect.isawaitable(result):
                await result