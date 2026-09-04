from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, cast
from urllib.parse import urlencode
from urllib.request import Request, urlopen


class SupabaseClient:
    def __init__(self, url: str, secret_key: str) -> None:
        self.url = url.rstrip("/")
        self.secret_key = secret_key

    def get_clanbattle_setting(self) -> dict[str, Any]:
        query = urlencode({"select": "*", "id": "eq.0", "limit": "1"})
        request = Request(
            f"{self.url}/rest/v1/setting_clanbattle?{query}",
            headers={
                "apikey": self.secret_key,
                "Authorization": f"Bearer {self.secret_key}",
            },
        )

        with urlopen(request, timeout=10) as response:
            raw_rows: object = json.load(response)

        if not isinstance(raw_rows, list) or not raw_rows or not isinstance(raw_rows[0], dict):
            raise RuntimeError("setting_clanbattle の id=0 が見つかりません")

        return cast(dict[str, Any], raw_rows[0])

    def register_clan_if_missing(self, clan_id: int, clan_name: str) -> bool:
        query = urlencode({"select": "clanid", "clanid": f"eq.{clan_id}", "limit": "1"})
        select_request = Request(
            f"{self.url}/rest/v1/clans?{query}",
            headers={
                "apikey": self.secret_key,
                "Authorization": f"Bearer {self.secret_key}",
            },
        )
        with urlopen(select_request, timeout=10) as response:
            existing_rows: object = json.load(response)

        if isinstance(existing_rows, list) and existing_rows:
            return False

        payload = json.dumps(
            {
                "clanid": str(clan_id),
                "name": clan_name,
                "bosslaps": [1, 1, 1, 1, 1],
                "createdAt": datetime.now(timezone.utc).isoformat(),
            }
        ).encode("utf-8")
        insert_request = Request(
            f"{self.url}/rest/v1/clans",
            data=payload,
            method="POST",
            headers={
                "apikey": self.secret_key,
                "Authorization": f"Bearer {self.secret_key}",
                "Content-Type": "application/json",
                "Prefer": "return=representation",
            },
        )

        with urlopen(insert_request, timeout=10) as response:
            raw_rows: object = json.load(response)

        return isinstance(raw_rows, list) and bool(cast(list[object], raw_rows))

    def get_clan(self, clan_id: int) -> dict[str, Any]:
        query = urlencode(
            {
                "select": "*",
                "clanid": f"eq.{clan_id}",
                "limit": "1",
            }
        )
        request = Request(
            f"{self.url}/rest/v1/clans?{query}",
            headers={
                "apikey": self.secret_key,
                "Authorization": f"Bearer {self.secret_key}",
            },
        )

        with urlopen(request, timeout=10) as response:
            raw_rows: object = json.load(response)

        if not isinstance(raw_rows, list) or not raw_rows or not isinstance(raw_rows[0], dict):
            raise RuntimeError(f"clans の clanid={clan_id} が見つかりません")

        return cast(dict[str, Any], raw_rows[0])

    def update_clan_bosslaps(self, clan_id: int, bosslaps: list[int]) -> None:
        query = urlencode({"clanid": f"eq.{clan_id}"})
        payload = json.dumps({"bosslaps": bosslaps}).encode("utf-8")
        request = Request(
            f"{self.url}/rest/v1/clans?{query}",
            data=payload,
            method="PATCH",
            headers={
                "apikey": self.secret_key,
                "Authorization": f"Bearer {self.secret_key}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            },
        )

        with urlopen(request, timeout=10):
            pass

    def insert_discord_clan_member_if_missing(
        self,
        clan_id: int,
        member_id: int,
        name: str,
        mention: str,
        yearmonth: str,
        role: str | None = None,
    ) -> None:
        now = datetime.now(timezone.utc).isoformat()
        member_data: dict[str, Any] = {
            "clanid": str(clan_id),
            "memberid": str(member_id),
            "name": name,
            "mention": mention,
            "attackdata": self.normalize_attackdata({"yearmonth": yearmonth}),
            "lastactive": now,
            "updated_at": now,
        }
        if role is not None:
            member_data["role"] = role

        payload = json.dumps(member_data).encode("utf-8")
        request = Request(
            f"{self.url}/rest/v1/clan_members?on_conflict=memberid",
            data=payload,
            method="POST",
            headers={
                "apikey": self.secret_key,
                "Authorization": f"Bearer {self.secret_key}",
                "Content-Type": "application/json",
                "Prefer": "resolution=ignore-duplicates,return=minimal",
            },
        )

        with urlopen(request, timeout=10):
            pass

    @staticmethod
    def normalize_attackdata(raw: object) -> dict[str, Any]:
        source = cast(dict[str, object], raw) if isinstance(raw, dict) else {}
        raw_attacktime = source.get("attacktime")
        attacktime: list[int | None] = []
        if isinstance(raw_attacktime, list):
            attacktime = [
                value if isinstance(value, int) else None
                for value in cast(list[object], raw_attacktime)[:3]
            ]

        return {
            "yearmonth": source.get("yearmonth") if isinstance(source.get("yearmonth"), str) else "",
            "sortie": source.get("sortie") if isinstance(source.get("sortie"), int) else 0,
            "attacklap": source.get("attacklap") if isinstance(source.get("attacklap"), int) else 0,
            "attackboss": source.get("attackboss") if isinstance(source.get("attackboss"), int) else 0,
            "overattack": source.get("overattack") if isinstance(source.get("overattack"), int) else None,
            "attacktime": attacktime,
            "damage": source.get("damage") if isinstance(source.get("damage"), int) else None,
            "attackmessage": source.get("attackmessage") if isinstance(source.get("attackmessage"), str) else None,
        }

    def get_clan_members(self, clan_id: int) -> list[dict[str, Any]]:
        query = urlencode({"select": "*", "clanid": f"eq.{clan_id}"})
        request = Request(
            f"{self.url}/rest/v1/clan_members?{query}",
            headers={
                "apikey": self.secret_key,
                "Authorization": f"Bearer {self.secret_key}",
            },
        )

        with urlopen(request, timeout=10) as response:
            raw_rows: object = json.load(response)

        if not isinstance(raw_rows, list):
            return []

        members: list[dict[str, Any]] = []
        for raw_row in cast(list[object], raw_rows):
            if not isinstance(raw_row, dict):
                continue
            row = cast(dict[str, Any], raw_row.copy())
            row["attackdata"] = self.normalize_attackdata(row.get("attackdata"))
            members.append(row)
        return members

    def update_discord_clan_member_attack(
        self,
        clan_id: int,
        member_id: int,
        boss: int,
        boss_lap: int,
        sortie: int,
        overattack: int,
        yearmonth: str,
    ) -> None:
        query = urlencode(
            {
                "select": "attackdata",
                "memberid": f"eq.{member_id}",
                "limit": "1",
            }
        )
        get_request = Request(
            f"{self.url}/rest/v1/clan_members?{query}",
            headers={
                "apikey": self.secret_key,
                "Authorization": f"Bearer {self.secret_key}",
            },
        )
        with urlopen(get_request, timeout=10) as response:
            rows = json.load(response)

        attackdata = self.normalize_attackdata(None)
        if isinstance(rows, list) and rows and isinstance(rows[0], dict):
            row = cast(dict[str, object], rows[0])
            attackdata = self.normalize_attackdata(row.get("attackdata"))

        attackdata.update(
            {
                "yearmonth": yearmonth,
                "attackboss": boss,
                "attacklap": boss_lap,
                "overattack": overattack,
                "damage": 0,
                "attackmessage": "",
                "sortie": sortie,
            }
        )
        update_query = urlencode({"memberid": f"eq.{member_id}"})
        payload = json.dumps(
            {
                "attackdata": attackdata,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        ).encode("utf-8")
        request = Request(
            f"{self.url}/rest/v1/clan_members?{update_query}",
            data=payload,
            method="PATCH",
            headers={
                "apikey": self.secret_key,
                "Authorization": f"Bearer {self.secret_key}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            },
        )

        with urlopen(request, timeout=10):
            pass