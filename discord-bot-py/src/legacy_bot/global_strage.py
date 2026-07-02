from __future__ import annotations

from .shared import *

class GlobalStrage:
    @staticmethod
    def SerializeList(data):
        result = []
        for d in data:
            result.append(d.Serialize())
        return result

    @staticmethod
    def Load():
        global BOSS_NAMES
        global BATTLE_START
        global BATTLE_END
        global BOSS_HP_DATA

        with open(SETTING_FILE) as a:
            mdic =  json.load(a)

            if 'BossName' in mdic:
                BOSS_NAMES = mdic['BossName']

            if 'BATTLESTART' in mdic:
                BATTLE_START = mdic['BATTLESTART']
                renewalCbday()

            if 'BATTLEEND' in mdic:
                BATTLE_END = mdic['BATTLEEND']

            if 'BossHpData' in mdic:
                BOSS_HP_DATA = mdic['BossHpData']

    @staticmethod
    def Save():
        dic = {
            'BossName' : BOSS_NAMES,
            'BATTLESTART' : BATTLE_START,
            'BATTLEEND' : BATTLE_END,
            'BossHpData' : BOSS_HP_DATA,
        }

        with open(SETTING_FILE, 'w') as a:
            json.dump(dic, a , indent=4)

#クランスコア計算ロジック


