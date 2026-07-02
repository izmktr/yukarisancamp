from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any


@dataclass(frozen=True)
class ClanBattleSetting:
    yearmonth: str
    bossname: list[str]
    bossHp: list[int]
    startDate: date
    endDate: date

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "ClanBattleSetting":
        yearmonth = str(payload.get("yearmonth", "")).strip()
        bossname = payload.get("bossname")
        boss_hp = payload.get("bossHp")
        start_date = payload.get("startDate")
        end_date = payload.get("endDate")

        if len(yearmonth) != 6 or not yearmonth.isdigit():
            raise RuntimeError("setting_clanbattle.yearmonth が不正です")
        if not isinstance(bossname, list) or len(bossname) != 5 or not all(isinstance(item, str) for item in bossname):
            raise RuntimeError("setting_clanbattle.bossname が不正です")
        if not isinstance(boss_hp, list) or len(boss_hp) != 5 or not all(isinstance(item, int) for item in boss_hp):
            raise RuntimeError("setting_clanbattle.bossHp が不正です")
        if not isinstance(start_date, str) or not isinstance(end_date, str):
            raise RuntimeError("setting_clanbattle の日付が不正です")

        return cls(
            yearmonth=yearmonth,
            bossname=bossname,
            bossHp=boss_hp,
            startDate=date.fromisoformat(start_date),
            endDate=date.fromisoformat(end_date),
        )