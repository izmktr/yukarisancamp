from __future__ import annotations

from .shared import *

class AttackHistory():
    keyarray = [
        'member',
        'day',
        'sortie',
        'messageid',
        'boss',
        'overtime',
        'defeat',
        'sortiecount',
        'updatetime'
    ]

    def __init__(self, member : "ClanMember", messageid, sortie, boss, overtime, defeat, sortiecount):
        self.member = member.id if member is not None else 0 #プレイヤー
        self.day = cbday                    #何日目か
        self.sortie = sortie                #何凸目か
        self.messageid = messageid          #凸に使ったメッセージID
        self.boss = boss                    #凸したボス
        self.overtime = overtime            #持ち越し秒数
        self.defeat = defeat                #敵を討伐したか
        self.sortiecount = sortiecount      #便宜上凸数(討伐or持ち越し凸なら0.5)
        self.updatetime = ''                #最終更新時間
        self.TimeStamping()

    def TimeStamping(self):
        self.updatetime = datetime.datetime.now().strftime("%Y/%m/%d %H:%M:%S")

    @staticmethod
    def Desrialize(dic):
        history = AttackHistory(None, 0, 0, -1, 0, False, 0)
        for key in AttackHistory.keyarray:
            if key in dic:
                history.__dict__[key] = dic[key]
        return history

    def Serialize(self):
        dic = {}
        for key in AttackHistory.keyarray:
            dic[key] = self.__dict__[key]
        return dic


