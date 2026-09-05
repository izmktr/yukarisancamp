from __future__ import annotations
import asyncio
import datetime
import random
import re
from typing import Any, cast, Callable, Awaitable

import discord

from .message_router import MessageRouter
# 推奨: モジュールごと import
from . import constants, encrypt

from .clan_member import ClanMember
from .damage_control import DamageControl
from .supabase_client import SupabaseClient

class MessageReaction():
    def __init__(
        self,
        member: ClanMember,
        addreaction: Callable[[ClanMember, discord.RawReactionActionEvent], Awaitable[bool]],
        removereaction: Callable[[ClanMember, discord.RawReactionActionEvent], Awaitable[bool]],
        deletereaction: Callable[[discord.RawMessageDeleteEvent], Awaitable[bool]],
    ) -> None:
        self.addreaction = addreaction
        self.removereaction = removereaction
        self.deletereaction = deletereaction
        self.member = member
        self.history_id: int | None = None
        self.selected_emoji: str | None = None
        self.action: str | None = None


class Clan(MessageRouter):
    numbermarks = [
        "\N{DIGIT ZERO}\N{COMBINING ENCLOSING KEYCAP}", # type: ignore
        "\N{DIGIT ONE}\N{COMBINING ENCLOSING KEYCAP}", # type: ignore
        "\N{DIGIT TWO}\N{COMBINING ENCLOSING KEYCAP}", # type: ignore
        "\N{DIGIT THREE}\N{COMBINING ENCLOSING KEYCAP}", # type: ignore
        "\N{DIGIT FOUR}\N{COMBINING ENCLOSING KEYCAP}", # type: ignore
        "\N{DIGIT FIVE}\N{COMBINING ENCLOSING KEYCAP}", # type: ignore
        "\N{DIGIT SIX}\N{COMBINING ENCLOSING KEYCAP}", # type: ignore
        "\N{DIGIT SEVEN}\N{COMBINING ENCLOSING KEYCAP}", # type: ignore
        "\N{DIGIT EIGHT}\N{COMBINING ENCLOSING KEYCAP}", # type: ignore
        "\N{DIGIT NINE}\N{COMBINING ENCLOSING KEYCAP}", # type: ignore
    ]

    emojis = [
        u"\u2705",
        "\N{DIGIT TWO}\N{COMBINING ENCLOSING KEYCAP}", # type: ignore
        "\N{DIGIT THREE}\N{COMBINING ENCLOSING KEYCAP}", # type: ignore
        "\N{DIGIT FOUR}\N{COMBINING ENCLOSING KEYCAP}", # type: ignore
        "\N{DIGIT FIVE}\N{COMBINING ENCLOSING KEYCAP}", # type: ignore
        "\N{DIGIT SIX}\N{COMBINING ENCLOSING KEYCAP}", # type: ignore
        "\N{DIGIT SEVEN}\N{COMBINING ENCLOSING KEYCAP}", # type: ignore
        "\N{DIGIT EIGHT}\N{COMBINING ENCLOSING KEYCAP}", # type: ignore
        "\N{DIGIT NINE}\N{COMBINING ENCLOSING KEYCAP}", # type: ignore
        u"\u274C",
    ]

    emojisoverkill = [
        u"\u2705",
        "\N{DIGIT ZERO}\N{COMBINING ENCLOSING KEYCAP}", # type: ignore
        u"\u274C",
    ]
    taskkillmark = u"\u2757"

    def __init__(
        self,
        input_channel_name: str = "凸報告",
        supabase: SupabaseClient | None = None,
        clan_id: int | None = None,
        yukalink_common_key: str = "",
    ) -> None:
        super().__init__(
            input_channel_name,
            [
                (["attack", "a", "凸", "あ"], self.Attack),
                (["c", "持"], self.ContinuesAttack),
                (["tl"], self.TimelineConvert),
                (['dice', 'サイコロ', 'ダイス'], self.Dice),
                (["defeat"], self.Defeat),
                (["undefeat"], self.Undefeat),
                (['setboss'], self.SetBoss),
                (['yukalink'], self.Yukalink),
                (["register", "登録"], self.RegisterClan),
                (['memberdelete'], self.MemberDelete),
                (['reset'], self.MemberReset),
                (['dailyreset'], self.DailyReset),
                (['monthlyreset'], self.MonthlyReset),
                (['settingreload'], self.SettingReload),
                (['damagechannel'], self.DamageChannel),
                (['taskkill', 'タスキル'], self.TaskKill),
            ],
        )
        self.members: dict[int, ClanMember] = {}

        self.dicehistory = [10, 30, 50, 70, 90]                 # ダイスが重複した値が出ないようにしたフラグ

        self.stampcheck :dict[int, int] = {}                    # スタンプの二重押し防止
        self.messagereaction : dict[int, MessageReaction] = {}
                                                                # スタンプを押したときの反応用

        self.supabase_data: dict[str, Any] | None = None
        self.supabase_bossstate: dict[str, Any] | None = None
        self.clanbattle_setting: dict[str, Any] | None = None
        self.supabase = supabase
        self.clan_id = clan_id
        self.yukalink_common_key = yukalink_common_key

        self.outputchannel = None
        self.outputlock = 0                                     # メッセージ出力中のロックフラグ

        self.damagecontrol = [DamageControl(self.members, bidx) for bidx in range(constants.BOSSNUMBER)]
                                                                # ダメコン用


        # self.messagereaction : Dict[int, MessageReaction] = {}
                                                                # スタンプを押したときの反応用

        # self.damagechannelid = [0] * BOSSNUMBER                 # ダメコンチャンネルID

    def CurrentBaseDate(self) -> str:
        japan_time = datetime.datetime.now(
            datetime.timezone(datetime.timedelta(hours=9))
        )
        return (japan_time - datetime.timedelta(hours=5)).date().isoformat()

    def ApplySupabaseMember(self, row: dict[str, Any]) -> None:
        raw_memberid = row.get("memberid")
        if not isinstance(raw_memberid, (int, str)):
            return
        try:
            memberid = int(raw_memberid)
        except (TypeError, ValueError):
            return

        member = self.members.get(memberid)
        if member is None:
            member = ClanMember(memberid)
            self.members[memberid] = member
        member.ApplyDatabaseRow(row)

    def LoadSupabaseMembers(self, rows: list[dict[str, Any]]) -> None:
        self.members.clear()
        for row in rows:
            self.ApplySupabaseMember(row)

    async def ReloadSupabaseMembers(self) -> None:
        if self.supabase is None or self.clan_id is None:
            return
        rows = await asyncio.to_thread(self.supabase.get_clan_members, self.clan_id)
        self.LoadSupabaseMembers(rows)


    async def _ack(self, message: discord.Message, title: str, member: discord.Member, opt: str) -> bool:
        response = f"{member.display_name} の {title} を受け付けました"
        if opt:
            response = f"{response}: {opt}"

        try:
            await message.reply(response, mention_author=False)
        except (discord.Forbidden, discord.HTTPException):
            print(response)

        return True

    def BossLap(self, bidx : int) -> int:
        if not constants.is_valid_boss(bidx):
            return 0

        if self.supabase_data is None:
            return 0

        raw_bosslaps: object = self.supabase_data.get("bosslaps")
        if not isinstance(raw_bosslaps, list):
            return 0

        bosslaps = cast(list[object], raw_bosslaps)
        if len(bosslaps) != constants.BOSSNUMBER:
            return 0

        bosslap = bosslaps[bidx - 1]
        return bosslap if isinstance(bosslap, int) else 0

    def BossLabel(self, bidx: int) -> str:
        if not constants.is_valid_boss(bidx) or self.clanbattle_setting is None:
            return str(bidx)

        raw_bossnames: object = self.clanbattle_setting.get("bossname")
        if not isinstance(raw_bossnames, list):
            return str(bidx)

        bossnames = cast(list[object], raw_bossnames)
        if len(bossnames) != constants.BOSSNUMBER:
            return str(bidx)

        bossname = bossnames[bidx - 1]
        if not isinstance(bossname, str) or not bossname.strip():
            return str(bidx)

        return f"{bidx}:{bossname}"

    async def SetBossLap(self, bidx : int, lap : int) -> bool:
        if not constants.is_valid_boss(bidx):
            return False

        if self.supabase_data is None or self.supabase is None or self.clan_id is None:
            return False

        raw_bosslaps: object = self.supabase_data.get("bosslaps")
        if not isinstance(raw_bosslaps, list):
            return False

        bosslaps = cast(list[object], raw_bosslaps).copy()
        if len(bosslaps) != constants.BOSSNUMBER:
            return False

        bosslaps[bidx - 1] = lap
        if not all(isinstance(value, int) for value in bosslaps):
            return False

        updated_bosslaps = cast(list[int], bosslaps)
        await asyncio.to_thread(
            self.supabase.update_clan_bosslaps,
            self.clan_id,
            updated_bosslaps,
        )
        self.supabase_data["bosslaps"] = updated_bosslaps
        return True

    def AddStamp(self, messageid : int):
        if messageid in self.stampcheck:
            self.stampcheck[messageid] += 1
        else:
            self.stampcheck[messageid] = 1
        return self.stampcheck[messageid]

    def RemoveStamp(self, messageid : int):
        if messageid in self.stampcheck:
            self.stampcheck[messageid] -= 1
        else:
            self.stampcheck[messageid] = 0
        return self.stampcheck[messageid]

    def emojiindex(self, emojistr : str) -> int | None:
        for idx, emoji in enumerate(self.emojis):
            if emoji == emojistr:
                return idx
        for idx, emoji in enumerate(self.emojisoverkill):
            if emoji == emojistr:
                return idx
        return None

    async def AddReaction(self, message : discord.Message, overkill: bool):
        reactemojis = self.emojis if not overkill else self.emojisoverkill

        for emoji in reactemojis:
            try:
                await message.add_reaction(emoji)
                await asyncio.sleep(0.1)
            except (discord.errors.NotFound, discord.errors.Forbidden):
                break

    def CreateAttackReaction(self, atmember : ClanMember, message : discord.Message, boss : int, sortie : int, overtime : int):
        react: MessageReaction

        def reaction_action(emoji: str) -> tuple[str, int] | None:
            if emoji == self.emojis[9]:
                return "cancel", 0
            if emoji == self.emojis[0]:
                return "complete", 0
            if overtime > 0:
                if emoji == self.numbermarks[0]:
                    return "defeat", 0
                return None
            if emoji in self.emojis[1:9]:
                index = self.emojis.index(emoji)
                return "defeat", (index + 1) * 10
            return None

        def apply_rpc_result(member: ClanMember, result: dict[str, Any]) -> None:
            member.ApplyDatabaseRow(
                {
                    "name": member.name,
                    "mention": member.mention,
                    "taskkill": member.taskkill,
                    "attacktime": result.get("attacktime"),
                    "attackdata": result.get("attackdata"),
                }
            )
            raw_bosslaps = result.get("bosslaps")
            if self.supabase_data is not None and isinstance(raw_bosslaps, list):
                self.supabase_data["bosslaps"] = raw_bosslaps

        async def addreaction(member : ClanMember, payload : discord.RawReactionActionEvent) -> bool:
            if member != atmember:
                return False

            emoji = payload.emoji.name
            action_data = reaction_action(emoji)
            if action_data is None:
                return False

            v = self.AddStamp(payload.message_id)
            if v != 1:
                return False

            action, result_overtime = action_data
            if self.supabase is None:
                self.RemoveStamp(payload.message_id)
                return False

            try:
                result = await asyncio.to_thread(
                    self.supabase.finish_clan_member_attack,
                    member.id,
                    member.name,
                    member.mention,
                    payload.message_id,
                    action,
                    result_overtime,
                )
            except Exception as exc:
                self.RemoveStamp(payload.message_id)
                self.TemporaryMessage(message.channel, f'攻撃の更新に失敗しました: {exc}')
                return False

            apply_rpc_result(member, result)
            raw_history_id = result.get("history_id")
            react.history_id = raw_history_id if isinstance(raw_history_id, int) else None
            react.selected_emoji = emoji
            react.action = action

            if action == "complete":
                await self.damagecontrol[boss - 1].Injure(member)
                await self.damagecontrol[boss - 1].SendResult()
            elif action == "cancel":
                await self.damagecontrol[boss - 1].Remove(member)
                await self.damagecontrol[boss - 1].SendResult()
            else:
                for attacking_member in self.members.values():
                    if attacking_member.IsAttack() and attacking_member.boss == boss:
                        attacking_member.reportlimit = datetime.datetime.now() + datetime.timedelta(minutes=5)

            if message.guild is not None:
                await self.RemoveReaction(message, 0 < overtime, message.guild.me)
            return True

        async def removereaction(member : ClanMember, payload : discord.RawReactionActionEvent) -> bool:
            if member != atmember:
                return False

            if react.selected_emoji != payload.emoji.name or react.action is None:
                return False

            v = self.RemoveStamp(payload.message_id)
            if v != 0:
                return False

            if member.attackmessage is None or member.attackmessage.id != payload.message_id:
                return False
            if self.supabase is None or self.clan_id is None:
                return False

            try:
                if react.action == "cancel":
                    await asyncio.to_thread(
                        self.supabase.update_discord_clan_member_attack,
                        self.clan_id,
                        member.id,
                        member.name,
                        member.mention,
                        boss,
                        self.BossLap(boss),
                        sortie,
                        1 if overtime > 0 else 0,
                        self.CurrentBaseDate(),
                    )
                    member.Attack(boss, sortie)
                elif react.history_id is not None:
                    result = await asyncio.to_thread(
                        self.supabase.revert_clan_member_attack,
                        member.id,
                        react.history_id,
                    )
                    apply_rpc_result(member, result)
                else:
                    raise RuntimeError("攻撃履歴が見つかりません")
            except Exception as exc:
                self.TemporaryMessage(message.channel, f'巻き戻しに失敗しました: {exc}')
                return True

            react.history_id = None
            react.selected_emoji = None
            react.action = None
            await self.AddReaction(message, 0 < overtime)
            return True


        async def deletereaction(payload: discord.RawMessageDeleteEvent) -> bool:
            if atmember.attackmessage is not None and atmember.attackmessage.id == payload.message_id:
                atmember.Cancel()
            return True

        react = MessageReaction(atmember, addreaction, removereaction, deletereaction)
        return react



    async def RemoveReaction(self, message : discord.Message, overkill : bool, me : discord.Member):
        reactemojis = self.emojis if not overkill else self.emojisoverkill

        for emoji in reactemojis:
            try:
                await message.remove_reaction(emoji, me)
            except (discord.errors.NotFound, discord.errors.Forbidden):
                break


    @staticmethod
    async def SendMessage(channel : discord.abc.Messageable, message : str):
        try:
            post = await channel.send(message)
            await asyncio.sleep(60)
            await post.delete()
        except (discord.errors.NotFound, discord.errors.Forbidden):
            pass

    def TemporaryMessage(self, channel: discord.abc.Messageable, message : str):
        asyncio.ensure_future(self.SendMessage(channel, message))

    def CheckInputChannel(self, message : discord.Message):
        channel_name = getattr(message.channel, "name", None)
        if self.input_channel_name != "" and channel_name != self.input_channel_name:
            return True
            
        return False

    def CheckNotAdministrator(self, message: discord.Message) -> bool:
        return not (
            isinstance(message.author, discord.Member)
            and message.author.guild_permissions.administrator
        )

    def CheckNotMasterAdministrator(self, clan : ClanMember, message : discord.Message):
        return False

    def IsAttackableBoss(self, bidx : int):
        if not constants.is_valid_boss(bidx):
            return False

        bosslaps = [self.BossLap(index) for index in range(1, constants.BOSSNUMBER + 1)]
        minlap = min(bosslaps)
        if minlap + 1 < self.BossLap(bidx):
            return False

        return True

    async def AttackCheck(self, message : discord.Message, member : ClanMember, bidx : int):
        if self.CheckInputChannel(message):
            self.TemporaryMessage(message.channel, '%s のチャンネルで発言してください' % constants.INPUT_CHANNEL) # type: ignore
            return True

        if not self.IsAttackableBoss(bidx):
            self.TemporaryMessage(message.channel, '攻撃できないボスです')
            return True

        if member.IsAttack():
            self.TemporaryMessage(message.channel, 'すでに凸があります 前の凸を無効にするにはcancelと入力してください')
            return True

        return False

    def GetMember(self, user : int) -> ClanMember | None:
        if user not in self.members:
            return None

        return self.members[user]

    async def Attack(self, message: discord.Message, member: discord.Member, opt: str) -> bool:
        cmember = self.GetMember(message.author.id)
        if cmember is None:
            self.TemporaryMessage(message.channel, '登録されていません 登録するにはregisterと入力してください')
            return False

        if cmember.IsAttack():
            self.TemporaryMessage(message.channel, 'すでに凸があります 前の凸を無効にするにはcancelと入力してください')
            return False

        try:
            if not re.fullmatch(r'\d{1,2}', opt):
                raise ValueError
            num = int(opt)
            boss = num if num < 10 else num // 10
            sortie = 0 if num < 10 else num % 10

            if not constants.is_valid_boss(boss) or (
                len(opt) == 2 and not constants.is_valid_sortie(sortie)
            ):
                raise ValueError
        except ValueError:
            self.TemporaryMessage(message.channel, '「凸5」 のように発言してください')
            return False

        overattack = 0
        if sortie == 0:
            if cmember.FirstSoriteNum() == 0:
                self.TemporaryMessage(message.channel, '新規凸がありません')
                return False
            
            sortie = cmember.SortieCount() + 1
        else:
            if cmember.attacktime[sortie - 1] is None or cmember.attacktime[sortie - 1] == 0:
                self.TemporaryMessage(message.channel, '持ち越しではありません')
                return False
            overattack = 1

        error = await self.AttackCheck(message, cmember, boss)
        if error:
            return False

        if self.supabase is not None and self.clan_id is not None:
            try:
                await asyncio.to_thread(
                    self.supabase.update_discord_clan_member_attack,
                    self.clan_id,
                    member.id,
                    member.display_name,
                    member.mention,
                    boss,
                    self.BossLap(boss),
                    sortie,
                    overattack,
                    self.CurrentBaseDate(),
                )
            except Exception as exc:
                self.TemporaryMessage(message.channel, f'攻撃の開始に失敗しました: {exc}')
                return False

        cmember.Attack(boss, sortie)
        cmember.name = member.display_name
        cmember.mention = member.mention
        cmember.UpdateActive()
        if cmember.attackmessage is not None:
            self.messagereaction.pop(cmember.attackmessage.id, None)
        cmember.attackmessage = message

        overtime = cmember.attacktime[sortie - 1] if overattack else 0
        self.messagereaction[message.id] = self.CreateAttackReaction(
            cmember,
            message,
            boss,
            sortie,
            overtime or 0,
        )

        if cmember.taskkill != 0:
            await message.add_reaction(self.taskkillmark)

        await self.AddReaction(message, bool(overattack))

        return True

    async def ContinuesAttack(self, message: discord.Message, member: discord.Member, opt: str) -> bool:
        return await self._ack(message, "ContinuesAttack", member, opt)

    async def TimelineConvert(self, message: discord.Message, member: discord.Member, opt: str) -> bool:
        lines = opt.splitlines(True)

        if not lines:
            self.TemporaryMessage(message.channel, '持ち越し時間を入力してください')
            return False

        tm = re.match(r'\d+', lines[0])
        if tm is None:
            self.TemporaryMessage(message.channel, '持ち越し時間を入力してください')
            return False

        overtime = int(tm.group())
        result = '持ち越し時間:%d秒\n' % overtime

        lines = lines[1:]

        for line in lines:
            offset = 0
            while True:
                m = re.search(r'(\d+)([:：])(\d+)', line[offset:])
                if m is None:
                    result += line[offset:]
                    break

                x = max(int(m.group(1)) * 60 + int(m.group(3)) - (90 - overtime), 0)
                if 0 < offset or 0 < x:
                    result += line[offset:offset + m.start()] + '%d:%02d' % (x // 60, x % 60)
                    offset += m.end()
                else:
                    break
        
        await message.channel.send('```' + result + '```')

        return False

    async def Dice(self, message: discord.Message, member: discord.Member, opt: str) -> bool:

        while True:
            rndstar = int(random.random() * 100 + 1)
            if rndstar not in self.dicehistory:
                if len(self.dicehistory) >= 5:
                    self.dicehistory = self.dicehistory[1:]
                self.dicehistory.append(rndstar)
                break

        await message.channel.send('%s %s %d' % (message.author.display_name, chr(int(0x1F3B2)), rndstar))

        return True

    async def Yukalink(self, message: discord.Message, member: discord.Member, opt: str) -> bool:
        if message.guild is None or self.supabase is None or self.clan_id is None:
            return False

        try:
            random_value = encrypt.decrypt(opt, self.yukalink_common_key).strip()
        except ValueError:
            self.TemporaryMessage(message.channel, '連携コードが正しくありません。Web画面から再生成してください')
            return False

        reply_key = encrypt.encrypt(
            ','.join([random_value, str(message.guild.id), str(message.author.id)]),
            self.yukalink_common_key,
        )
        text = f"以下のコードをWebに入力して下さい\n```\n{reply_key}\n```"
        admin = not self.CheckNotAdministrator(message)

        # supabaseのpublic.clan_membersに自分自身の情報を登録
        await asyncio.to_thread(
            self.supabase.insert_discord_clan_member_if_missing,
            self.clan_id,
            member.id,
            member.display_name,
            member.mention,
            self.CurrentBaseDate(),
            "leader" if admin else "member",
        )
        await self.ReloadSupabaseMembers()

        self.TemporaryMessage(message.channel, text)
        return False

    async def Encrypt(self, message: discord.Message, member: discord.Member, opt: str) -> bool:
        # Implementation for the Encrypt command
        print(f"Encrypt command received from {member.display_name}: [{opt}] [{self.yukalink_common_key}]")
        reply_key = encrypt.encrypt(opt, self.yukalink_common_key)

        reverse = encrypt.decrypt(reply_key, self.yukalink_common_key)
        text = f"```\n{reply_key}\n{reverse}\n```"


        self.TemporaryMessage(message.channel, text)
        return False

    async def RegisterClan(self, message: discord.Message, member: discord.Member, opt: str) -> bool:
        if self.supabase_data is None or self.supabase is None or self.clan_id is None:
            return False

        admin = not self.CheckNotAdministrator(message)

        # supabaseのpublic.clan_membersに自分自身の情報を登録
        await asyncio.to_thread(
            self.supabase.insert_discord_clan_member_if_missing,
            self.clan_id,
            member.id,
            member.display_name,
            member.mention,
            self.CurrentBaseDate(),
            "leader" if admin else "member",
        )
        await self.ReloadSupabaseMembers()

        return False

    async def MemberDelete(self, message: discord.Message, member: discord.Member, opt: str) -> bool:
        if self.CheckNotAdministrator(message):
            return False

        result = self.DeleteMember(opt)
        if result is not None:
            self.TemporaryMessage(message.channel, '%s を消しました' % result.name)
            return True
        else:
            self.TemporaryMessage(message.channel, 'メンバーがいません')
            return False

    async def MemberReset(self, message: discord.Message, member: discord.Member, opt: str) -> bool:
        
        return True
    async def DailyReset(self, message: discord.Message, member: discord.Member, opt: str) -> bool:
        return True
    async def MonthlyReset(self, message: discord.Message, member: discord.Member, opt: str) -> bool:
        return True
    async def SettingReload(self, message: discord.Message, member: discord.Member, opt: str) -> bool:
        return True
    async def DamageChannel(self, message: discord.Message, member: discord.Member, opt: str) -> bool:
        return True
    async def TaskKill(self, message: discord.Message, member: discord.Member, opt: str) -> bool:
        return True

    async def Defeat(self, message: discord.Message, member: discord.Member, opt: str) -> bool:
        # optのbossindexのlapを増やし、supabaseのpublic.clansのbosslapsを更新

        if self.supabase_data is None or self.supabase is None or self.clan_id is None:
            return False

        try:
            num = int(opt)
            bidx = num if num < 10 else num // 10

            if not constants.is_valid_boss(bidx):
                raise ValueError
        except ValueError:
            self.TemporaryMessage(message.channel, '「defeat 5」 のように発言してください')
            return False

        if not self.IsAttackableBoss(bidx):
            self.TemporaryMessage(message.channel, 'このボスは討伐済みに出来ません')
            return False
        
        newlap = self.BossLap(bidx) + 1
        await self.SetBossLap(bidx, newlap)
        self.TemporaryMessage(message.channel, f'{self.BossLabel(bidx)}の周回数を{newlap}に更新しました') 

        return True

    async def Undefeat(self, message: discord.Message, member: discord.Member, opt: str) -> bool:
        # optのbossindexのlapを減らし、supabaseのpublic.clansのbosslapsを更新
        if self.supabase_data is None or self.supabase is None or self.clan_id is None:
            return False

        try:
            num = int(opt)
            bidx = num if num < 10 else num // 10

            if not constants.is_valid_boss(bidx):
                raise ValueError
        except ValueError:
            self.TemporaryMessage(message.channel, '「undefeat 5」 のように発言してください')
            return False

        newlap = max(self.BossLap(bidx) - 1, 0)
        maxlap = max(self.BossLap(index) for index in range(1, constants.BOSSNUMBER + 1))
        if newlap < maxlap - 1:
            self.TemporaryMessage(message.channel, f'{self.BossLabel(bidx)}の周回数を減らすことはできません')
            return False

        if newlap < 0:
            self.TemporaryMessage(message.channel, f'{self.BossLabel(bidx)}の周回数を減らすことはできません')
            return False
        result = await self.SetBossLap(bidx, newlap)

        if not result:
            self.TemporaryMessage(message.channel, f'更新時にエラーが発生しました')
            return False
        self.TemporaryMessage(message.channel, f'{self.BossLabel(bidx)}の周回数を{newlap}に更新しました') 

        return True

    async def SetBoss(self, message: discord.Message, member: discord.Member, opt: str) -> bool:
        if self.supabase_data is None or self.supabase is None or self.clan_id is None:
            return False

        try:
            sp = opt.split(' ')
            if len(sp) != constants.BOSSNUMBER:
                raise ValueError

            data = [int(s) - 1 for s in sp]
            minlap = min([m for m in data if 0 <= m])
            overlap = minlap + 1 if minlap + 2 in constants.LevelUpLap else minlap + 2

            if len([m for m in data if overlap < m]):
                self.TemporaryMessage(message.channel, '周回数がおかしいデータがあります')
                return False

            bosslaps = [m if 0 <= m else overlap for m in data]

            await asyncio.to_thread(
                self.supabase.update_clan_bosslaps,
                self.clan_id,
                bosslaps,
            )
            self.supabase_data["bosslaps"] = bosslaps

            self.TemporaryMessage(message.channel, 'ボスを設定しました')
        except ValueError:
            self.TemporaryMessage(message.channel, 'setboss [ボス周回数] × 5 でボスの周回数を設定します(0は未出現)\n例)setboss 5 4 0 0 4')

        return True

    async def OnRawReactionAdd(self, payload: discord.RawReactionActionEvent) -> bool:
        member = self.GetMember(payload.user_id)
        reaction = self.messagereaction.get(payload.message_id)
        if member is None or reaction is None:
            return False
        return await reaction.addreaction(member, payload)

    async def OnRawReactionRemove(self, payload: discord.RawReactionActionEvent) -> bool:
        member = self.GetMember(payload.user_id)
        reaction = self.messagereaction.get(payload.message_id)
        if member is None or reaction is None:
            return False
        return await reaction.removereaction(member, payload)

    def MinLap(self) -> int:
        if self.supabase_data is None:
            return 0

        raw_bosslaps: object = self.supabase_data.get("bosslaps")
        if not isinstance(raw_bosslaps, list):
            return 0

        bosslaps = cast(list[object], raw_bosslaps)
        if len(bosslaps) != constants.BOSSNUMBER:
            return 0

        minlap = min((lap for lap in bosslaps if isinstance(lap, int)), default=0)
        return minlap

    def NumberMark(self, l : list[int]):
        return [self.numbermarks[i] for i in l]

    def StatusBoss(self):
        s = ''
        minlap = self.MinLap()

        s += 'ボス情報 '
        bossmark = self.NumberMark([i + 1 for i in range(1, constants.BOSSNUMBER) if self.BossLap(i) == minlap])
        s += '%d周 %s' % (minlap + 1, ' '.join(bossmark))

        if (minlap + 2) not in constants.LevelUpLap:
            bossmark = self.NumberMark([i + 1 for i in range(1, constants.BOSSNUMBER) if self.BossLap(i) == minlap + 1])
            if 0 < len(bossmark):
                s += ' / %d周 %s' % (minlap + 2, ' '.join(bossmark))

        level = self.BossLap(minlap)
        if level < len(constants.LevelUpLap):
            s += ' %d周から%d段階目' % (constants.LevelUpLap[level], level + 2)

        return s + '\n'

    def StatusAttack(self):
        attacklist : list[list[ClanMember]] = [ [] for _i in range(constants.BOSSNUMBER) ]
        for member in self.members.values():
            if member.IsAttack():
                bidx = member.AttackBoss()
                attacklist[bidx - 1].append(member)

        if sum([len(m) for m in attacklist]) == 0 : return ''

        s = '攻撃中\n'
        for at in attacklist:
            if 0 < len(at):
                namelist = [m.DecoName('nOTv') for m in at]
                s += '%s %d人 %s\n' % (self.numbermarks[at[0].AttackBoss()], len(at), ' '.join(namelist))

        return s

    def StatusOverkill(self):
        s = ''
        tstr = ['フル', '長', '中', '短']
        time = [0] * len(tstr)

        for m in self.members.values():
            for t in m.attacktime:
                if t is not None and 0 < t:
                    if t == 90: time[0] += 1
                    elif 70 <= t: time[1] += 1
                    elif 40 <= t: time[2] += 1
                    else: time[3] += 1

        if 0 < sum(time):
            s += '持越 '
            s += '  '.join(['%s:%d' % (tstr[i], time[i]) for i in range(len(tstr)) if 0 < time[i] ])
            s += '\n'

        return s

    def StatusMemberList(self):
        s = ''
        
        fulllist : list[list[ClanMember]] = [[] for _i in range(constants.MAX_SORTIE + 1) ]

        for m in self.members.values():
            if not m.DayFinish():
                fulllist[m.SortieCount()].append(m)

        for i, mem in enumerate(fulllist):
            if 0 < len(mem):
                s += '**残%d凸 %d人**\n' % (constants.MAX_SORTIE - i, len(mem))
                s += '  '.join([m.DecoName('nXT') for m in mem]) + '\n'
        
        unfinish = sum([len(m) for m in fulllist])
        if len(self.members) != unfinish:
            membernum = len(self.members)
            s += '**完凸 %d人/%d人(%d凸/%d凸)**\n' % (membernum - unfinish, membernum, self.TotalSortieCount(), membernum * constants.MAX_SORTIE)
        
        return s

    def TotalSortieCount(self) -> int:
        return sum(member.SortieCount() for member in self.members.values())

    def Status(self) -> str:
        s = ''

        s += self.StatusBoss()
        s += self.StatusAttack()
        s += self.StatusOverkill()

        s += '\n' + self.StatusMemberList()

        return s
    
    async def OnSupabaseUpdateClans(self, old_data: dict[str, Any], new_data: dict[str, Any]) -> None:
        self.supabase_data = new_data

    async def OnSupabaseUpdateClanMembers(self, old_data: dict[str, Any], new_data: dict[str, Any]) -> None:
        self.ApplySupabaseMember(new_data)


    async def OnSupabaseUpdateClanBossState(self, old_data: dict[str, Any], new_data: dict[str, Any]) -> None:
        self.supabase_bossstate = new_data

    def FindChannel(self, guild : discord.Guild, name : str) -> discord.TextChannel | None:
        return discord.utils.get(guild.text_channels, name=name)

    async def OnMessageHandled(self, guild: discord.Guild) -> None:
        if self.outputchannel is None:
            self.outputchannel = self.FindChannel(guild, constants.OUTPUT_CHANNEL)

        if self.outputchannel is not None:
            if self.outputlock == 1: return
            while self.outputlock != 0:
                await asyncio.sleep(1)

            if self.lastmessage is not None:
                self.outputlock = 1
                try:
                    await self.lastmessage.delete()
                except (discord.errors.NotFound, discord.errors.Forbidden):
                    pass
                self.lastmessage = None

            try:
                self.outputlock = 2
                self.lastmessage = await self.outputchannel.send(self.Status())
            except discord.errors.Forbidden:
                self.outputchannel = None
            finally:
                self.outputlock = 0

