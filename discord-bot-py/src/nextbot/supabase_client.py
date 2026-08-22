from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any
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
            rows = json.load(response)

        if not isinstance(rows, list) or not rows or not isinstance(rows[0], dict):
            raise RuntimeError("setting_clanbattle の id=0 が見つかりません")

        return rows[0]

    def register_clan_if_missing(self, clan_id: int, clan_name: str) -> bool:
        payload = json.dumps(
            {
                "id": clan_id,
                "name": clan_name,
                "bossindex": [0, 0, 0, 0, 0],
                "createdAt": datetime.now(timezone.utc).isoformat(),
            }
        ).encode("utf-8")
        insert_request = Request(
            f"{self.url}/rest/v1/clan?on_conflict=id",
            data=payload,
            method="POST",
            headers={
                "apikey": self.secret_key,
                "Authorization": f"Bearer {self.secret_key}",
                "Content-Type": "application/json",
                "Prefer": "resolution=ignore-duplicates,return=representation",
            },
        )

        with urlopen(insert_request, timeout=10) as response:
            rows = json.load(response)

        return isinstance(rows, list) and bool(rows)