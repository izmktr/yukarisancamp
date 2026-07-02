from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from dotenv import load_dotenv
import os


@dataclass(frozen=True)
class ClanBattleSetting:
    yearmonth: str
    bossname: list[str]
    boss_hp: list[int]
    start_date: str
    end_date: str

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "ClanBattleSetting":
        yearmonth = str(payload.get("yearmonth", "")).strip()
        bossname = payload.get("bossname")
        boss_hp = payload.get("bossHp")
        start_date = payload.get("startDate")
        end_date = payload.get("endDate")

        if not isinstance(bossname, list) or not isinstance(boss_hp, list):
            raise RuntimeError("setting_clanbattle payload is invalid")

        return cls(
            yearmonth=yearmonth,
            bossname=[str(v) for v in bossname],
            boss_hp=[int(v) for v in boss_hp],
            start_date=str(start_date),
            end_date=str(end_date),
        )


def fetch_rows(base_url: str, secret_key: str, table: str, query: dict[str, str]) -> list[dict[str, Any]]:
    request = Request(
        url=f"{base_url.rstrip('/')}/rest/v1/{table}?{urlencode(query)}",
        headers={
            "apikey": secret_key,
            "Authorization": f"Bearer {secret_key}",
            "Accept": "application/json",
        },
        method="GET",
    )

    with urlopen(request) as response:
        payload = json.loads(response.read().decode("utf-8"))

    if not isinstance(payload, list):
        raise RuntimeError(f"Invalid response from {table}")

    return payload


def fetch_latest_event(base_url: str, secret_key: str) -> dict[str, Any] | None:
    rows = fetch_rows(
        base_url,
        secret_key,
        "setting_clanbattle_events",
        {
            "select": "id,yearmonth,event_type,source,triggered_by,created_at",
            "order": "id.desc",
            "limit": "1",
        },
    )
    return rows[0] if rows else None


def fetch_latest_clanbattle_setting(base_url: str, secret_key: str) -> ClanBattleSetting:
    rows = fetch_rows(
        base_url,
        secret_key,
        "setting_clanbattle",
        {
            "select": "yearmonth,bossname,bossHp,startDate,endDate",
            "order": "yearmonth.desc",
            "limit": "1",
        },
    )
    if not rows:
        raise RuntimeError("setting_clanbattle has no rows")
    return ClanBattleSetting.from_payload(rows[0])


def print_setting(setting: ClanBattleSetting, event: dict[str, Any]) -> None:
    print("\n=== setting_clanbattle updated ===")
    print(f"event_id: {event.get('id')}")
    print(f"event_type: {event.get('event_type')}")
    print(f"source: {event.get('source')}")
    print(f"triggered_by: {event.get('triggered_by')}")
    print(f"created_at: {event.get('created_at')}")
    print(f"yearmonth: {setting.yearmonth}")
    print(f"startDate: {setting.start_date}")
    print(f"endDate: {setting.end_date}")
    print("bossname:", ", ".join(setting.bossname))
    print("bossHp:", ", ".join(str(v) for v in setting.boss_hp))


def main() -> None:
    env_path = Path(__file__).resolve().parent / ".env.local"
    load_dotenv(env_path)

    base_url = os.getenv("SUPABASE_URL", "").strip()
    secret_key = os.getenv("SUPABASE_SECRET_KEY", "").strip()

    if not base_url or not secret_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SECRET_KEY are required in sample/.env.local")

    print("Watching setting_clanbattle_events...")

    latest_event = fetch_latest_event(base_url, secret_key)
    latest_event_id = None if latest_event is None else int(latest_event.get("id"))

    while True:
        time.sleep(5)
        try:
            event = fetch_latest_event(base_url, secret_key)
            if event is None:
                continue

            event_id = int(event.get("id"))
            if latest_event_id is not None and event_id <= latest_event_id:
                continue

            latest_event_id = event_id
            setting = fetch_latest_clanbattle_setting(base_url, secret_key)
            print_setting(setting, event)
        except Exception as exc:
            print(f"watch failed: {exc}")


if __name__ == "__main__":
    main()
