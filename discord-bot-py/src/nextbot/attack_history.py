from __future__ import annotations

from .clan_member import ClanMember
import datetime
from typing import Any

class AttackHistory():
    def __init__(self, member : ClanMember, day : int, messageid : int, sortie : int, boss : int, overtime : int, defeat : bool, sortiecount : float, clanid : int = 0, serial : int = 0):
        self.clanid = clanid                #クランID
        self.serial = serial                #連番
        self.member = member.id             #プレイヤー
        self.day = day                      #何日目か
        self.sortie : int = sortie          #何凸目か
        self.messageid = messageid          #凸に使ったメッセージID
        self.boss = boss                    #凸したボス
        self.overtime = overtime            #持ち越し秒数
        self.defeat = defeat                #敵を討伐したか
        self.sortiecount = sortiecount      #便宜上凸数(討伐or持ち越し凸なら0.5)
        self.updatetime = ''                #最終更新時間
        self.TimeStamping()

    def TimeStamping(self):
        self.updatetime = datetime.datetime.now(datetime.timezone.utc).isoformat()

    def Serialize(self) -> dict[str, Any]:
        # attackHistory.schema.json に合わせてJSON化
        return {
            "clanid": int(self.clanid),
            "serial": int(self.serial),
            "member": int(self.member),
            "day": int(self.day),
            "sortie": int(self.sortie),
            "messageid": str(self.messageid),
            "boss": int(self.boss),
            "overtime": int(self.overtime),
            "defeat": bool(self.defeat),
            "sortiecount": float(self.sortiecount),
            "updatetime": str(self.updatetime),
        }

    def to_json(self) -> dict[str, Any]:
        return self.Serialize()

    def to_supabase_row(self) -> dict[str, Any]:
        row = self.Serialize()
        # serial=0 は未採番扱いとし、DB の identity で一意採番させる
        if int(row.get("serial", 0)) <= 0:
            row.pop("serial", None)
        return row

    def save_to_supabase(self, supabase_client: Any) -> None:
        if not hasattr(supabase_client, "upsert_attack_history"):
            raise RuntimeError("supabase_client does not support upsert_attack_history")
        supabase_client.upsert_attack_history(self.to_supabase_row())

    @staticmethod
    def Desrialize(dic: dict[str, Any]) -> AttackHistory:
        # 既存コード互換のメソッド名（Desrialize）
        attack = AttackHistory.__new__(AttackHistory)
        attack.clanid = int(dic.get("clanid", 0))
        attack.serial = int(dic.get("serial", 0))
        attack.member = int(dic.get("member", 0))
        attack.day = int(dic.get("day", 0))
        attack.sortie = int(dic.get("sortie", 0))
        attack.messageid = str(dic.get("messageid", ""))
        attack.boss = int(dic.get("boss", 0))
        attack.overtime = int(dic.get("overtime", 0))
        attack.defeat = bool(dic.get("defeat", False))
        attack.sortiecount = float(dic.get("sortiecount", 0))
        attack.updatetime = str(dic.get("updatetime", ""))
        return attack

    @staticmethod
    def from_json(dic: dict[str, Any]) -> AttackHistory:
        return AttackHistory.Desrialize(dic)



