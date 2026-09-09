from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, cast
from urllib.error import HTTPError
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

    def get_clan_boss_states(self, clan_id: int, yearmonth: str) -> list[dict[str, Any]]:
        query = urlencode(
            {
                "select": "boss_index,current_hp,max_hp,is_defeated",
                "clanid": f"eq.{clan_id}",
                "yearmonth": f"eq.{yearmonth}",
                "order": "boss_index.asc",
            }
        )
        request = Request(
            f"{self.url}/rest/v1/clan_boss_state?{query}",
            headers={
                "apikey": self.secret_key,
                "Authorization": f"Bearer {self.secret_key}",
            },
        )

        with urlopen(request, timeout=10) as response:
            raw_rows: object = json.load(response)

        if not isinstance(raw_rows, list):
            return []

        return [
            cast(dict[str, Any], row)
            for row in raw_rows
            if isinstance(row, dict)
        ]

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

    def update_clan_discord_data(
        self,
        clan_id: int,
        discord_data: dict[str, Any],
    ) -> None:
        query = urlencode({"clanid": f"eq.{clan_id}"})
        payload = json.dumps({"discord_data": discord_data}).encode("utf-8")
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
        day: str,
        role: str | None = None,
    ) -> None:
        now = datetime.now(timezone.utc).isoformat()
        member_data: dict[str, Any] = {
            "clanid": str(clan_id),
            "memberid": str(member_id),
            "name": name,
            "mention": mention,
            "day": day,
            "attacktime": [],
            "attackdata": self.normalize_attackdata({"day": day}),
            "lastactive": now,
            "updated_at": now,
        }
        if role is not None:
            member_data["role"] = role

        payload = json.dumps(member_data).encode("utf-8")
        query = urlencode({"on_conflict": "clanid,memberid"})
        request = Request(
            f"{self.url}/rest/v1/clan_members?{query}",
            data=payload,
            method="POST",
            headers={
                "apikey": self.secret_key,
                "Authorization": f"Bearer {self.secret_key}",
                "Content-Type": "application/json",
                "Prefer": "resolution=ignore-duplicates,return=minimal",
            },
        )

        try:
            with urlopen(request, timeout=10):
                pass
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(
                f"Supabase clan member registration failed: {exc.code} {detail}"
            ) from exc

    def delete_discord_clan_member(self, clan_id: int, member_id: int) -> bool:
        query = urlencode(
            {
                "clanid": f"eq.{clan_id}",
                "memberid": f"eq.{member_id}",
            }
        )
        request = Request(
            f"{self.url}/rest/v1/clan_members?{query}",
            method="DELETE",
            headers={
                "apikey": self.secret_key,
                "Authorization": f"Bearer {self.secret_key}",
                "Accept": "application/json",
                "Prefer": "return=representation",
            },
        )

        with urlopen(request, timeout=10) as response:
            raw_rows: object = json.load(response)

        return isinstance(raw_rows, list) and len(cast(list[object], raw_rows)) > 0

    def reset_discord_clan_member(self, clan_id: int, member_id: int) -> None:
        query = urlencode(
            {
                "clanid": f"eq.{clan_id}",
                "memberid": f"eq.{member_id}",
            }
        )
        payload = json.dumps(
            {
                "taskkill": None,
                "attacktime": [],
                "attackdata": {
                    "day": "",
                    "sortie": 0,
                    "lap": 0,
                    "boss": 0,
                    "overattack": None,
                    "damage": None,
                    "message": None,
                },
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        ).encode("utf-8")
        request = Request(
            f"{self.url}/rest/v1/clan_members?{query}",
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

    def delete_today_attack_histories(
        self,
        clan_id: int,
        member_id: int,
        day: str,
    ) -> None:
        query = urlencode(
            {
                "clanid": f"eq.{clan_id}",
                "memberid": f"eq.{member_id}",
                "day": f"eq.{day}",
            }
        )
        request = Request(
            f"{self.url}/rest/v1/attack_histories?{query}",
            method="DELETE",
            headers={
                "apikey": self.secret_key,
                "Authorization": f"Bearer {self.secret_key}",
                "Prefer": "return=minimal",
            },
        )

        with urlopen(request, timeout=10):
            pass

    def update_clan_member_taskkill(
        self,
        clan_id: int,
        member_id: int,
        day: str,
    ) -> None:
        query = urlencode(
            {
                "clanid": f"eq.{clan_id}",
                "memberid": f"eq.{member_id}",
            }
        )
        payload = json.dumps({"taskkill": day}).encode("utf-8")
        request = Request(
            f"{self.url}/rest/v1/clan_members?{query}",
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

    @staticmethod
    def normalize_attackdata(raw: object) -> dict[str, Any]:
        source = cast(dict[str, object], raw) if isinstance(raw, dict) else {}
        raw_day = source.get("day")
        if not isinstance(raw_day, str):
            raw_day = source.get("yearmonth")
        return {
            "day": raw_day if isinstance(raw_day, str) else "",
            "sortie": source.get("sortie") if isinstance(source.get("sortie"), int) else 0,
            "lap": source.get("lap") if isinstance(source.get("lap"), int) else source.get("attacklap") if isinstance(source.get("attacklap"), int) else 0,
            "boss": source.get("boss") if isinstance(source.get("boss"), int) else source.get("attackboss") if isinstance(source.get("attackboss"), int) else 0,
            "overattack": source.get("overattack") if isinstance(source.get("overattack"), int) else None,
            "damage": source.get("damage") if isinstance(source.get("damage"), int) else None,
            "message": source.get("message") if isinstance(source.get("message"), str) else source.get("attackmessage") if isinstance(source.get("attackmessage"), str) else None,
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
        name: str,
        mention: str,
        boss: int,
        boss_lap: int,
        sortie: int,
        overattack: int,
        day: str,
    ) -> None:
        query = urlencode(
            {
                "select": "attackdata,attacktime",
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
                "day": day,
                "boss": boss,
                "lap": boss_lap,
                "overattack": overattack,
                "damage": 0,
                "message": "",
                "sortie": sortie,
            }
        )
        update_query = urlencode({"memberid": f"eq.{member_id}"})
        now = datetime.now(timezone.utc).isoformat()
        payload = json.dumps(
            {
                "name": name,
                "mention": mention,
                "attackdata": attackdata,
                "lastactive": now,
                "updated_at": now,
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

    def _call_attack_rpc(self, function_name: str, parameters: dict[str, Any]) -> dict[str, Any]:
        payload = json.dumps(parameters).encode("utf-8")
        request = Request(
            f"{self.url}/rest/v1/rpc/{function_name}",
            data=payload,
            method="POST",
            headers={
                "apikey": self.secret_key,
                "Authorization": f"Bearer {self.secret_key}",
                "Content-Type": "application/json",
            },
        )
        with urlopen(request, timeout=10) as response:
            raw_result: object = json.load(response)

        if not isinstance(raw_result, dict):
            raise RuntimeError(f"{function_name} returned an invalid response")
        return cast(dict[str, Any], raw_result)

    def finish_clan_member_attack(
        self,
        member_id: int,
        name: str,
        mention: str,
        message_id: int,
        action: str,
        overtime: int,
    ) -> dict[str, Any]:
        return self._call_attack_rpc(
            "finish_clan_member_attack",
            {
                "p_memberid": str(member_id),
                "p_name": name,
                "p_mention": mention,
                "p_messageid": str(message_id),
                "p_action": action,
                "p_overtime": overtime,
            },
        )

    def revert_clan_member_attack(
        self,
        member_id: int,
        history_id: int,
    ) -> dict[str, Any]:
        return self._call_attack_rpc(
            "revert_clan_member_attack",
            {
                "p_memberid": str(member_id),
                "p_history_id": history_id,
            },
        )