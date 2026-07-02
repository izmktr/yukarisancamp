from __future__ import annotations

from .shared import *
from .score_calc_result import ScoreCalcResult

class ClanScore:
    @staticmethod
    def Calc(score) -> Optional[ScoreCalcResult]:
        total = 0
        level = 0
        while level < len(LEVEL_UP_LAP):
            prevlap = (LEVEL_UP_LAP[level - 1] if 0 < level else 1)
            upperlap = LEVEL_UP_LAP[level] - prevlap
            if score < total + upperlap * BossLapScore[level]:
                break
            total += upperlap * BossLapScore[level]
            level += 1
        
        lap = (score - total) // BossLapScore[level] + (LEVEL_UP_LAP[level - 1] if 0 < level else 1)
        modscore = (score - total) % BossLapScore[level]

        totalscore = 0
        bindex = 0
        while bindex < BOSSNUMBER:
            nowbossscore = BOSS_HP_DATA[level][bindex][2]

            if modscore < totalscore + nowbossscore:
                hprate = int(100 - (modscore - totalscore) * 100 // nowbossscore)
                return ScoreCalcResult(lap, level, bindex, hprate,  modscore)
            totalscore += nowbossscore
            bindex += 1

        return None


