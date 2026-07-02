from __future__ import annotations

import asyncio
import calendar
import codecs
import datetime
import glob
import json
import math
import os
import random
import re
from functools import cmp_to_key
from io import BytesIO, StringIO
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, TypeVar

import discord
from discord.ext import tasks
from PIL import Image, ImageDraw, ImageFont

try:
    from config import (
        INPUT_CHANNEL,
        OUTPUT_CHANNEL,
        BOSS_NAMES,
        MAX_SORTIE,
        BATTLE_START,
        BATTLE_END,
        CLAN_BATTLE_TERM,
        DAY_MINUTES,
        LEVEL_UP_LAP,
        BOSS_HP_DATA,
        GACHA_LOT_DATA,
        ERROR_LOG_FILE,
        SETTING_FILE,
        MA_LAP,
        RESERVE_LAP,
        VERY_HARD_LAP,
    )
except ImportError:
    INPUT_CHANNEL = 'input'
    OUTPUT_CHANNEL = 'output'
    BOSS_NAMES = ['Boss1', 'Boss2', 'Boss3', 'Boss4', 'Boss5']
    MAX_SORTIE = 3
    BATTLE_START = '01/01'
    BATTLE_END = '01/05'
    CLAN_BATTLE_TERM = 5
    DAY_MINUTES = 24 * 60
    LEVEL_UP_LAP = [4, 10, 26]
    BOSS_HP_DATA = [
        [[6000000, 1], [8000000, 1], [10000000, 1], [12000000, 1], [15000000, 1]],
        [[8000000, 1.1], [10000000, 1.1], [12000000, 1.1], [14000000, 1.1], [17000000, 1.1]],
        [[10000000, 1.2], [12000000, 1.2], [14000000, 1.2], [16000000, 1.2], [20000000, 1.2]],
    ]
    GACHA_LOT_DATA = []
    ERROR_LOG_FILE = 'error.log'
    SETTING_FILE = 'setting.json'
    MA_LAP = 5
    RESERVE_LAP = 1000
    VERY_HARD_LAP = 0

T = TypeVar('T')

BossName = BOSS_NAMES
BossHpData = BOSS_HP_DATA
LevelUpLap = LEVEL_UP_LAP
BATTLESTART = BATTLE_START
BATTLEEND = BATTLE_END
CLANBATTLETERM = CLAN_BATTLE_TERM
MAX_SORITE = MAX_SORTIE
ERRFILE = ERROR_LOG_FILE
RESERVELAP = RESERVE_LAP

BossLapScore: List[float] = []
for l in BOSS_HP_DATA:
    lapscore = 0
    for item in l:
        lapscore += item[0] * item[1]
        if len(item) < 3:
            item.append(item[0] * item[1])
        else:
            item[2] = item[0] * item[1]
    BossLapScore.append(lapscore)

BOSSNUMBER = len(BOSS_NAMES)
cbday = 0
clanhash: Dict[int, 'Clan'] = {}
client = None


def sign(n: int):
    if n < 0:
        return -1
    if 0 < n:
        return 1
    return 0


def renewalCbday():
    global cbday
    start = datetime.datetime.strptime(BATTLESTART + ' 05:00', '%m/%d %H:%M')
    nowtime = datetime.datetime.now()
    now = datetime.datetime.strptime(nowtime.strftime('%m/%d %H:%M'), '%m/%d %H:%M')
    cbday = (now - start).days


def SpaceBossName():
    maxlen = max([len(name) for name in BossName])
    return [name + '　' * (maxlen - len(name)) for name in BossName]


def BlendColor(color1, color2):
    return (
        (color1[0] + color2[0]) // 2,
        (color1[1] + color2[1]) // 2,
        (color1[2] + color2[2]) // 2,
    )


def ScriptText(value):
    return '```\n' + value + '\n```'


def DateCalc(nowdate, deltadays):
    date = datetime.datetime.strptime(nowdate, '%m/%d')
    return (date + datetime.timedelta(days=deltadays)).strftime('%m/%d')


def Outlog(filename, data):
    datetime_format = datetime.datetime.now()
    datestr = datetime_format.strftime('%Y/%m/%d %H:%M:%S')
    print(datestr + ' ' + str(data), file=codecs.open(filename, 'a', 'utf-8'))
