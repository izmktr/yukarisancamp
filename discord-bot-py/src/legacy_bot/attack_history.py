from __future__ import annotations

from .shared import *
from .clan_member import ClanMember

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

    def __init__(self, member : ClanMember, messageid : int, sortie : int, boss : int, overtime : int, defeat : bool, sortiecount : float):
        self.member = member.id             #プレイヤー
        self.day = cbday                    #何日目か
        self.sortie : int = sortie          #何凸目か
        self.messageid = messageid          #凸に使ったメッセージID
        self.boss = boss                    #凸したボス
        self.overtime = overtime            #持ち越し秒数
        self.defeat = defeat                #敵を討伐したか
        self.sortiecount = sortiecount      #便宜上凸数(討伐or持ち越し凸なら0.5)
        self.updatetime = ''                #最終更新時間
        self.TimeStamping()

    def TimeStamping(self):
        self.updatetime = datetime.datetime.now().strftime("%Y/%m/%d %H:%M:%S")



