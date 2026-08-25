import datetime
from typing import Optional
import discord

from . import constants

class ClanMember():
    def __init__(self, id : int):
        self.id = id                                    # ユーザーID
        self.name : str = ''                                  # ユーザーの名前
        self.mention : str = ''                               # メンションするときの名前
        self.taskkill = 0                               # タスキルをした回数

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

    def IsAttack(self):
        return self.sortie != -1

    def IsOverkill(self) -> bool:
        if not self.IsAttack(): return False
        time = self.attacktime[self.sortie]
        return time is not None and 0 < time

    #未凸数
    def FirstSoriteNum(self) -> int:
        return len([m for m in self.attacktime if m is None])

    #指定したLapで凸した回数
    def LapCount(self, lap : int) -> float:
        return len([m for m in self.attacktime if m is not None and m // 10 == lap])

    def DecoName(self, opt : str) -> str:
        s: str = ''
        for c in opt:
            if c == 'n': 
                s += self.name
            elif c == 't': 
                if self.taskkill: s += 'tk'
            elif c == 'T': 
                if self.taskkill: s += '[tk]'
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
                if self.IsAttack() and self.IsOverkill():
                    s += '[v%d]' % (self.Overtime(self.sortie) // 10)
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
        self.CreateHistory(messageid, self.sortie, self.boss, 0, defeat, sortiecount)
        self.attacktime[self.sortie] = 0
        self.sortie = -1
        self.reportlimit = None
    
    def Cancel(self):
        self.sortie = -1
        self.reportlimit = None

    def Overkill(self, messageid : int, overtime : int):
        if self.sortie < 0: return
        self.CreateHistory(messageid, self.sortie, self.boss, overtime, True, 1)
        self.attacktime[self.sortie] = overtime
        self.sortie = -1
        self.reportlimit = None

    def Overtime(self, sortie):
        return self.attacktime[sortie]

    def MessageChcck(self, messageid):
        for h in self.history:
            if h.messageid == messageid:
                return True
        return False

    def Reset(self):
        self.sortie = -1
        self.reportlimit = None
        self.taskkill = 0
        self.history.clear()
        self.attacktime = [None] * MAX_SORTIE

    selializemember = [
        'name', 
        'taskkill', 
        'attacktime',
        'plan',
        ]

    def Serialize(self):
        ret = {}

        for key, value in self.__dict__.items():
            if key in self.selializemember:
                ret[key] = value
        
        ret['history'] = [m.Serialize() for m in self.history]
        return ret

    def Deserialize(self, dic):
        for key, value in dic.items():
            if key == 'history':
                self.__dict__[key] = [AttackHistory.Desrialize(m) for m in value]
            else:
                self.__dict__[key] = value

    def Revert(self, messageid):
        if len(self.history) == 0: return None

        ret = [m for m in self.history if m.messageid == messageid]
        if 0 < len(ret):
            self.history.remove(ret[0])
            self.Attack(ret[0].boss, ret[0].sortie)
            self.CreateAttackTime()
            return ret[0]
        return None

    def CalcAttackTime(self, sortie : int):
        history = [m for m in self.history if m.sortie == sortie]
        if len(history) == 0: return None
        return min([h.overtime for h in history])

    def CreateAttackTime(self):
        self.attacktime = [self.CalcAttackTime(i) for i in range(MAX_SORITE)]

    def DayFinish(self):
        for t in self.attacktime:
            if t is None or 0 < t: return False
        
        return True
    
    def UpdateActive(self):
        self.lastactive = datetime.datetime.now()

    def PlanFromHistory(self):
        result : List[AttackHistory] = []
        reserve = set()
        for h in self.history:
            # フル凸 or 60秒以上の戦闘
            if 1 <= h.sortiecount:
                result.append(h)
            else:
                if 0 < h.overtime:
                    if h.overtime <= 50:
                        result.append(h)
                    else:
                        reserve.add(h.sortie)
                else:
                    if h.sortie in reserve:
                        result.append(h)

        return [h.boss % BOSSNUMBER for h in result if VERY_HARD_LAP <= h.boss]
    
    


