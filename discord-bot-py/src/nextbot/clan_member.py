import datetime
from typing import Optional
import discord

class ClanMember():
    def __init__(self, id):
        self.id = id                                    # ユーザーID
        self.name = ''                                  # ユーザーの名前
        self.mention = ''                               # メンションするときの名前
        self.taskkill = 0                               # タスキルをした回数

        self.attacktime : list[Optional[int]] = [None] * 3           # 攻撃管理フラグ(None:未凸, 数値:持ち越し時刻)

        self.sortie = -1                                # 攻撃中判定
        self.boss = 0                                   # 攻撃ボス
        self.attackmessage: Optional[discord.Message] = None    # 攻撃宣言のメッセージ
        self.reportlimit = None                         # 催促される時刻の期限

        self.lastactive = datetime.datetime.now() + datetime.timedelta(days = -1)
                                                        # 最後に発言した時刻