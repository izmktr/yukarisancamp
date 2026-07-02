from __future__ import annotations

import json
from dataclasses import dataclass
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .clanbattle_setting import ClanBattleSetting


@dataclass(frozen=True)
class SupabaseClient:
    url: str
    secret_key: str

    def fetch_clanbattle_setting(self) -> ClanBattleSetting:
        query = urlencode(
            {
                "select": "yearmonth,bossname,bossHp,startDate,endDate",
                "order": "yearmonth.desc",
                "limit": "1",
            }
        )
        request = Request(
            url=f"{self.url.rstrip('/')}/rest/v1/setting_clanbattle?{query}",
            headers={
                "apikey": self.secret_key,
                "Authorization": f"Bearer {self.secret_key}",
                "Accept": "application/json",
            },
            method="GET",
        )

        with urlopen(request) as response:
            payload = json.loads(response.read().decode("utf-8"))

        if not isinstance(payload, list) or not payload:
            raise RuntimeError("setting_clanbattle から有効な設定を取得できませんでした")

        return ClanBattleSetting.from_payload(payload[0])