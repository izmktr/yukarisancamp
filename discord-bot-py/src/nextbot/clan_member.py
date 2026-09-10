import datetime
from typing import Any, Optional, cast
import discord

from . import constants

class ClanMember():
    def __init__(self, id: str):
        self.id = id                                    # ユーザーID
        self.name : str = ''                                  # ユーザーの名前
        self.mention : str = ''                               # メンションするときの名前
        self.taskkill: str = ''                    # タスキルした基準日

        self.attacktime : list[Optional[int]] = [None] * constants.MAX_SORTIE  # 攻撃管理フラグ(None:未凸, 数値:持ち越し時刻)

        self.sortie = -1                                # 攻撃中判定
        self.boss = 0                                   # 攻撃ボス
        self.attackmessage: Optional[discord.Message] = None    # 攻撃宣言のメッセージ
        self.reportlimit: Optional[datetime.datetime] = None    # 催促される時刻の期限

        self.lastactive = datetime.datetime.now() + datetime.timedelta(days = -1)
                                                        # 最後に発言した時刻

    def Attack(self, bossindex : int, sortie : int):
        self.sortie = sortie
        self.reportlimit = datetime.datetime.now() + datetime.timedelta(minutes = 30)
        self.boss = bossindex

    def AttackBoss(self) -> int:
        return self.boss

    def ApplyDatabaseRow(self, row: dict[str, Any]) -> None:
        name = row.get("name")
        mention = row.get("mention")
        taskkill = row.get("taskkill")
        self.name = name if isinstance(name, str) else ""
        self.mention = mention if isinstance(mention, str) else ""
        self.taskkill = taskkill if isinstance(taskkill, str) else ""

        raw_attackdata = row.get("attackdata")
        attackdata = cast(dict[str, object], raw_attackdata) if isinstance(raw_attackdata, dict) else {}
        raw_attacktime = row.get("attacktime")
        if not isinstance(raw_attacktime, list):
            raw_attacktime = attackdata.get("attacktime")
        attacktime = cast(list[object], raw_attacktime) if isinstance(raw_attacktime, list) else []
        self.attacktime = [
            value if isinstance(value, int) else None
            for value in attacktime[:constants.MAX_SORTIE]
        ]
        self.attacktime.extend([None] * (constants.MAX_SORTIE - len(self.attacktime)))

        attackboss = attackdata.get("boss", attackdata.get("attackboss"))
        sortie = attackdata.get("sortie")
        if isinstance(attackboss, int) and constants.is_valid_boss(attackboss) \
                and isinstance(sortie, int) and constants.is_valid_sortie(sortie):
            self.boss = attackboss
            self.sortie = sortie
        else:
            self.boss = 0
            self.sortie = -1

    def IsAttack(self):
        return self.sortie != -1

    def IsOverkill(self) -> bool:
        if not self.IsAttack(): return False
        time = self.attacktime[self.sortie - 1]
        return time is not None and 0 < time

    #未凸数
    def FirstSoriteNum(self) -> int:
        return len([m for m in self.attacktime if m is None])

    #指定したLapで凸した回数
    def LapCount(self, lap : int) -> float:
        return len([m for m in self.attacktime if m is not None and m // 10 == lap])

    def HasTaskKill(self, base_date: str) -> bool:
        return self.taskkill == base_date

    def DecoName(self, opt : str, base_date: str | None = None) -> str:
        if base_date is None:
            base_date = constants.reference_date()

        s: str = ''
        for c in opt:
            if c == 'n': 
                s += self.name
            elif c == 't': 
                if self.HasTaskKill(base_date): s += 'tk'
            elif c == 'T': 
                if self.HasTaskKill(base_date): s += '[tk]'
            elif c == 'o':
                s += self.AttackTag(False)
            elif c == 'O':
                s += '[' + self.AttackTag(False) + ']'
            elif c == 'x':
                s += self.AttackTag(True)
            elif c == 'X':
                atag = self.AttackTag(True)
                if 0 < len(atag):
                    s += '[%s]' % atag
            elif c == 'v':
                if self.IsAttack():
                    overtime = self.Overtime(self.sortie)
                    if overtime is not None and 0 < overtime:
                        s += '[v%d]' % (overtime // 10)
            else: s += c

        return s

    #便宜上凸数
    def SortieCount(self):
        return constants.MAX_SORTIE - self.FirstSoriteNum()
    
    def AttackCharactor(self, at : Optional[int], short : bool):
        if at is None : return '' if short else 'o'
        if at == 0 : return 'x'
        return '%d' % (at // 10)

    def AttackTag(self, short : bool):
        return ''.join([self.AttackCharactor(m, short) for m in self.attacktime])
    
    def Finish(self, messageid : int, defeat : bool = False, sortiecount : int = 2):
        if self.sortie < 0: return
        self.attacktime[self.sortie - 1] = 0
        self.sortie = -1
        self.reportlimit = None
    
    def Cancel(self):
        self.sortie = -1
        self.reportlimit = None

    def Overkill(self, messageid : int, overtime : int):
        if self.sortie < 0: return
        self.attacktime[self.sortie - 1] = overtime
        self.sortie = -1
        self.reportlimit = None

    def Overtime(self, sortie: int) -> Optional[int]:
        return self.attacktime[sortie - 1]

    def Reset(self):
        self.sortie = -1
        self.reportlimit = None
        self.taskkill = ''
        self.attacktime = [None] * constants.MAX_SORTIE

    def DayFinish(self):
        for t in self.attacktime:
            if t is None or 0 < t: return False
        
        return True
    
    def UpdateActive(self):
        self.lastactive = datetime.datetime.now()


    # def PlanFromHistory(self):
    #     result : list[AttackHistory] = []
    #     reserve = set()
    #     for h in self.history:
    #         # フル凸 or 60秒以上の戦闘
    #         if 1 <= h.sortiecount:
    #             result.append(h)
    #         else:
    #             if 0 < h.overtime:
    #                 if h.overtime <= 50:
    #                     result.append(h)
    #                 else:
    #                     reserve.add(h.sortie)
    #             else:
    #                 if h.sortie in reserve:
    #                     result.append(h)
    #     return [h.boss % constants.BOSSNUMBER for h in result if constants.VERY_HARD_LAP <= h.boss]
    
    


