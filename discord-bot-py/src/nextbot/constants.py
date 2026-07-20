"""Shared game constants for nextbot modules."""

# Number of bosses in one lap.
BOSSNUMBER = 5

# Max daily attacks (sortie).
MAX_SORTIE = 3

INPUT_CHANNEL = "凸報告"
OUTPUT_CHANNEL = "状況報告"

# bossの値が正しいか
def is_valid_boss(boss: int) -> bool:
    return 0 < boss <= BOSSNUMBER

# sortieの値が正しいか
def is_valid_sortie(sortie: int) -> bool:
    return 0 < sortie <= MAX_SORTIE
