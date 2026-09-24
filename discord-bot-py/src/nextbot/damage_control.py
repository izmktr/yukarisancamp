from __future__ import annotations
import asyncio
from functools import cmp_to_key
from typing import TYPE_CHECKING
import math

import discord
from . import constants
from .clan_member import ClanMember

if TYPE_CHECKING:
    from .clan import Clan

class DamageControlMember:
    def __init__(self, member : ClanMember, damage : int, message : str = '', mark : int = 0) -> None:
        self.member : ClanMember = member
        self.damage : int = damage
        self.status : int = 0
        self.message : str = message
        self.mark : int = mark

class DamageControl():

    def __init__(self, clanmembers: dict[str, ClanMember], bossindex: int):
        self.active : bool = False
        self.lastmessage : discord.Message | None = None
        self.channel : discord.TextChannel | None = None
        self.remainhp : int = 0
        self.bossname : str = ''
        self.bossindex : int = bossindex
        self.members : dict[ClanMember, DamageControlMember] = {}
        self._post_lock = asyncio.Lock()
        self._status_dirty = False
        self.clanmembers: dict[str, ClanMember] = clanmembers

    def ChannelId(self) -> int:
        if self.channel is None:
            return 0
        return self.channel.id

    def SetChannel(self, channel : discord.TextChannel | None) -> None:
        self.channel = channel

    def SetBossHp(self, bosshp : int) -> None:
        self.remainhp = bosshp

    def SetBossName(self, bossname : str) -> None:
        self.bossname : str = bossname

    def RemainHp(self, hp : int) -> None:
        self.active = True
        self.remainhp = hp

    async def TryDisplay(self):
        if 0 < len(self.members):
             await self.SendResult()

    def Damage(self, member : ClanMember, damage : int, message : str = '', mark : int = 0):
        self.active = True
        self.members[member] = DamageControlMember(member, damage, message, mark)

    def MemberSweep(self):
        if len([m for m in self.members.values() if m.status == 0]) == 0:
            self.members.clear()
            self.active = False

    async def Remove(self, member : ClanMember):
        if member in self.members:
            del self.members[member]
            self.MemberSweep()

    async def Injure(self, member : ClanMember):
        if member in self.members:
            m = self.members[member]
            self.remainhp -= m.damage
            if self.remainhp < 0 : self.remainhp = 0
            
            m.damage = 0
            m.status = 1

            self.MemberSweep()

    def IsAutoExecutive(self):
        if self.channel is None: return False
        if self.active: return False
        if 0 < self.remainhp: return False
        return True

    @staticmethod
    def AttackBoss(member : ClanMember):
        return member.boss - 1

    def IsAttackMember(self, member : ClanMember):
        return self.AttackBoss(member) == self.bossindex

    def IsSetRemainHp(self, clan : Clan, member : ClanMember):
        if self.IsAttackMember(member): return True
        
        for dc in clan.damagecontrol:
            if dc != self and dc.channel == self.channel: return False
        return True

    @staticmethod
    def OverTime(remainhp : int, damage : int, overkill : bool):
        if overkill: return 0

        max = 90
        bonus = 20

        if damage < remainhp: return 0

        d = max  - math.floor(max * remainhp / damage) + bonus
        if max < d: return max
        return d

    def DefeatInfomation(self, slist : list[DamageControlMember], dcm : DamageControlMember, limit : int = 3):
        result : list[tuple[str, int]] = []
        thp = self.remainhp - dcm.damage

        i = 0

        found = False
        moverkill = dcm.member.IsOverkill()
        for s in slist:
            if dcm == s:
                found = True
                continue
                
            if thp <= s.damage:
                if s.member.IsOverkill() and (not found or not moverkill) : continue

                result.append( (s.member.name, self.OverTime(thp, s.damage, s.member.IsOverkill() )) )
                i += 1
                if limit <= i: break

        return result

    def DefeatCount(self, damagelist : list[DamageControlMember]):
        defeatcount = 1
        dsum = 0
        for n in damagelist:
            dsum += n.damage
            if self.remainhp <= dsum:
                break
            if 0 < n.damage and n.status == 0:
                defeatcount += 1
        
        return defeatcount

    def Status(self):
        mes = ''

        def Compare(a : DamageControlMember, b : DamageControlMember):
            ao = a.member.IsOverkill() if 0 < a.damage else False
            bo = b.member.IsOverkill() if 0 < b.damage else False

            if ao == bo:
                return (b.damage > a.damage) - (b.damage < a.damage)
            return (bo > ao) - (bo < ao)

        damagelist : list[DamageControlMember] = sorted([value for value in self.members.values()], key=cmp_to_key(Compare)) 
        totaldamage = sum([n.damage for n in damagelist])

        attackmember = set([
            m for m in self.clanmembers.values()
            if m.IsAttack() and (m.boss - 1) % constants.BOSSNUMBER == self.bossindex
        ])

        mes += '%s HP %d' % (self.bossname, self.remainhp)
        if 0 < totaldamage and totaldamage < self.remainhp:
            mes += '  不足分 %d' % (self.remainhp - totaldamage)
        else:
            defeatcount = self.DefeatCount(damagelist)
            if 3 <= defeatcount:
                last = damagelist[defeatcount - 1]
                namelist: list[str] = []

                remainhp = self.remainhp
                for m in damagelist:
                    remainhp -= m.damage
                    if 0 < remainhp:
                        namelist.append(m.member.name + '[%d]' % remainhp)
                
                namelist.append(last.member.name)

                mes += '\n' + '→'.join(namelist)
                prevdamage = sum([damagelist[i].damage for i in range(defeatcount - 1) ])
                mes += ' %d秒' % self.OverTime(self.remainhp - prevdamage, last.damage, last.member.IsOverkill() )

        for m in damagelist:
            if m.status == 0:
                attackmember.discard(m.member)
                suffix = '' if m.mark == 0 else "\u2620"
                if 0 < m.damage:
                    suffix += '%d' % m.damage

                mes += '\n%s %s' % (m.member.DecoName('nOTv'), suffix)
                if m.message != '':
                    mes += ' ' + m.message

                if self.remainhp <= m.damage:
                    if m.member.IsOverkill():
                        mes += ' 0秒'
                    else:
                        mes += ' %d秒' % (self.OverTime(self.remainhp, m.damage, False))
                    
                else :
                    dinfo = self.DefeatInfomation(damagelist, m)

                    if 0 < len(dinfo):
                        mes += ''. join(['  →%s %d秒' % (d[0], d[1]) for d in dinfo])
                    else:
                        if 0 < m.damage:
                            mes += '  残り %d' % (self.remainhp - m.damage)
        
        finishmember = [m.member.DecoName('nOT') for m in damagelist if m.status != 0]

        if 0 < len(finishmember):
            mes += '\n通過済み %s' % (' '.join(finishmember))

        if 0 < len(attackmember):
            mes += '\n未報告 %s' % (' '.join([m.DecoName('nOTv') for m in attackmember]))
        return mes

    async def SendResult(self):
        if not self.active:
            return

        # 投稿中に来た更新要求は取りこぼさず、投稿完了後に最新状態でもう一度投稿する
        self._status_dirty = True
        if self._post_lock.locked():
            return

        async with self._post_lock:
            await self._FlushStatus()

    async def SendFinish(self, message : str):
        async with self._post_lock:
            try:
                if self.active and self.lastmessage is not None:
                    await self._ReplaceMessage(message)
            except Exception as exc:
                print(f"ダメコンの討伐メッセージ送信に失敗しました: {self.bossname}: {exc!r}")
            finally:
                self.active = False
                self.lastmessage = None
                self.remainhp = 0
                self.members.clear()

            await self._FlushStatus()

    async def _FlushStatus(self):
        while self._status_dirty:
            self._status_dirty = False
            if not self.active:
                continue
            try:
                await self._ReplaceMessage(self.Status())
            except Exception as exc:
                print(f"ダメコンの更新に失敗しました: {self.bossname}: {exc!r}")

    async def _ReplaceMessage(self, mes : str):
        if self.lastmessage is not None:
            try:
                await self.lastmessage.delete()
            except (discord.errors.NotFound, discord.errors.Forbidden):
                pass
            self.lastmessage = None

        if self.channel is None:
            return
        try:
            self.lastmessage = await self.channel.send(mes)
        except discord.errors.Forbidden:
            self.channel = None
