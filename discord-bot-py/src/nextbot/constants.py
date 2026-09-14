"""Shared game constants for nextbot modules."""

import datetime

JST = datetime.timezone(datetime.timedelta(hours=9))

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
def now_jst() -> datetime.datetime:
    return datetime.datetime.now(JST)


def as_jst(value: datetime.datetime) -> datetime.datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=JST)
    return value.astimezone(JST)


def scheduled_datetime(day: datetime.date, hour: int, minute: int = 0) -> datetime.datetime:
    return datetime.datetime(day.year, day.month, day.day, hour, minute, tzinfo=JST)


def crossed_scheduled_time(
    last_run: datetime.datetime,
    target: datetime.datetime,
    now: datetime.datetime,
) -> bool:
    return as_jst(last_run) < as_jst(target) <= as_jst(now)


def reference_date(now: datetime.datetime | None = None) -> str:
    # 5:00～翌日の4:59までを1日とする基準日
    if now is None:
        now = now_jst()
    else:
        now = as_jst(now)
    return (now - datetime.timedelta(hours=5)).date().isoformat()


CLANBATTLE_EVE_MESSAGE = (
    "おはようございます\n"
    "明日よりクランバトルです。状況報告に名前が出ていない人は、"
    "今日中にこのチャンネルで「register」または「登録」と発言してください。"
)
CLANBATTLE_START_MESSAGE = (
    "おはようございます\n"
    "いよいよクランバトルの開始です。頑張りましょう。"
)
CLANBATTLE_LAST_DAY_MESSAGE = (
    "おはようございます\n"
    "今日がクランバトル最終日です。24時が終了時刻ですので早めに攻撃を終わらせましょう。"
)
CLANBATTLE_END_MESSAGE = "クランバトル終了です。お疲れさまでした。"