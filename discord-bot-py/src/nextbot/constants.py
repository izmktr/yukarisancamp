"""Shared game constants for nextbot modules."""

# Number of bosses in one lap.
BOSSNUMBER = 5

# Max daily attacks (sortie).
MAX_SORTIE = 3

INPUT_CHANNEL = "凸報告"
OUTPUT_CHANNEL = "状況報告"

VERY_HARD_LAP = 23

LevelUpLap : list[int] = [0, 7, 23]

# bossの値が正しいか
def is_valid_boss(boss: int) -> bool:
    return 0 < boss <= BOSSNUMBER

# sortieの値が正しいか
def is_valid_sortie(sortie: int) -> bool:
    return 0 < sortie <= MAX_SORTIE

# 基準日
def reference_date() -> str:
    # 5:00～翌日の4:59までを1日とする基準日
    import datetime
    now = datetime.datetime.now()
    if now.hour < 5:
        now -= datetime.timedelta(days=1)
    return now.strftime("%Y-%m-%d")