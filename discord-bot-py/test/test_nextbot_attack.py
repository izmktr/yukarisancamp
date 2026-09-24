from __future__ import annotations

import asyncio
import datetime
import io
import json
import types
import unittest
from typing import Any, cast
from unittest.mock import AsyncMock, MagicMock, patch
from urllib.parse import parse_qs, urlsplit

import discord

from src.nextbot import constants
from src.nextbot.clan import Clan
from src.nextbot.clan_member import ClanMember
from src.nextbot.damage_control import DamageControl
from src.nextbot.runtime import NextBotApp
from src.nextbot.supabase_client import SupabaseClient


class AttackTests(unittest.IsolatedAsyncioTestCase):
    def create_clan(self, attacktime: list[int | None] | None = None) -> tuple[Clan, ClanMember, MagicMock]:
        supabase = MagicMock()
        clan = Clan(supabase=supabase, clan_id=123)
        clan.supabase_data = {"bosslaps": [1, 1, 1, 1, 1]}
        member = ClanMember("456")
        member.name = "old name"
        member.mention = "<@456>"
        member.attacktime = attacktime or [None, None, None]
        clan.members[member.id] = member
        clan.AddReaction = AsyncMock()
        return clan, member, supabase

    @staticmethod
    def create_message(message_id: int = 100) -> types.SimpleNamespace:
        return types.SimpleNamespace(
            id=message_id,
            author=types.SimpleNamespace(id=456, display_name="new name"),
            channel=types.SimpleNamespace(name="凸報告"),
            guild=types.SimpleNamespace(me=types.SimpleNamespace()),
            add_reaction=AsyncMock(),
        )

    @staticmethod
    def create_discord_member() -> types.SimpleNamespace:
        return types.SimpleNamespace(
            id=456,
            display_name="new name",
            mention="<@456>",
        )

    async def test_member_reset_uses_id_when_display_names_collide(self) -> None:
        clan, member, supabase = self.create_clan([20, 0, None])
        other = ClanMember("999")
        other.name = member.name
        other.attacktime = [0, 0, 0]
        clan.members = {other.id: other, member.id: member}
        clan.TemporaryMessage = MagicMock()
        caller = types.SimpleNamespace(id=456, display_name=other.name)

        self.assertTrue(await clan.MemberReset(self.create_message(), caller, ""))

        supabase.reset_discord_clan_member.assert_called_once_with(123, "456")
        self.assertEqual(supabase.delete_today_attack_histories.call_args.args[:2], (123, "456"))
        self.assertEqual(other.attacktime, [0, 0, 0])
        self.assertEqual(member.attacktime, [None, None, None])

    async def test_member_reset_rejects_unregistered_user_with_matching_name(self) -> None:
        clan, member, supabase = self.create_clan([20, 0, None])
        clan.TemporaryMessage = MagicMock()
        caller = types.SimpleNamespace(id=999, display_name=member.name)

        self.assertFalse(await clan.MemberReset(self.create_message(), caller, ""))

        supabase.reset_discord_clan_member.assert_not_called()
        supabase.delete_today_attack_histories.assert_not_called()
        self.assertEqual(member.attacktime, [20, 0, None])

    async def test_member_reset_accepts_member_after_display_name_change(self) -> None:
        clan, _, supabase = self.create_clan()
        clan.TemporaryMessage = MagicMock()
        self.assertTrue(await clan.MemberReset(self.create_message(), self.create_discord_member(), ""))
        supabase.reset_discord_clan_member.assert_called_once_with(123, "456")

    @staticmethod
    def create_role_member(member_id: int, name: str, admin: bool = False, bot: bool = False) -> types.SimpleNamespace:
        return types.SimpleNamespace(
            id=member_id,
            display_name=name,
            mention=f"<@{member_id}>",
            bot=bot,
            guild_permissions=types.SimpleNamespace(administrator=admin),
        )

    def create_setmember_message(self, roles: list[types.SimpleNamespace]) -> types.SimpleNamespace:
        return types.SimpleNamespace(
            channel=types.SimpleNamespace(name="凸報告"),
            guild=types.SimpleNamespace(roles=roles, chunked=True, chunk=AsyncMock()),
            role_mentions=[],
        )

    async def test_setmember_registers_all_role_members(self) -> None:
        clan, _member, supabase = self.create_clan()
        clan.TemporaryMessage = MagicMock()
        clan.CheckNotAdministrator = MagicMock(return_value=False)
        role = types.SimpleNamespace(
            name="クランメンバー",
            members=[
                self.create_role_member(456, "既存"),
                self.create_role_member(789, "新規"),
                self.create_role_member(111, "リーダー", admin=True),
                self.create_role_member(222, "bot", bot=True),
            ],
        )

        async def reload() -> None:
            for target in role.members:
                if not target.bot:
                    clan.members.setdefault(str(target.id), ClanMember(str(target.id)))

        clan.ReloadSupabaseMembers = AsyncMock(side_effect=reload)

        self.assertTrue(await clan.SetMember(self.create_setmember_message([role]), MagicMock(), "クランメンバー"))

        calls = supabase.insert_discord_clan_member_if_missing.call_args_list
        self.assertEqual([call.args[1] for call in calls], [456, 789, 111])
        self.assertEqual([call.args[5] for call in calls], ["member", "member", "leader"])
        self.assertEqual(clan.members["789"].name, "新規")
        self.assertIn("3 人中 2 人", clan.TemporaryMessage.call_args.args[1])

    async def test_setmember_reports_missing_role(self) -> None:
        clan, _member, supabase = self.create_clan()
        clan.TemporaryMessage = MagicMock()
        clan.CheckNotAdministrator = MagicMock(return_value=False)

        self.assertFalse(await clan.SetMember(self.create_setmember_message([]), MagicMock(), "存在しない"))

        supabase.insert_discord_clan_member_if_missing.assert_not_called()
        self.assertIn("見つかりません", clan.TemporaryMessage.call_args.args[1])

    async def test_setboss_stores_input_laps_as_is(self) -> None:
        clan, _member, supabase = self.create_clan()
        clan.TemporaryMessage = MagicMock()
        clan.OnChangeBoss = AsyncMock()

        self.assertTrue(await clan.SetBoss(self.create_message(), MagicMock(), "1 1 2 2 2"))

        supabase.update_clan_bosslaps.assert_called_once_with(123, [1, 1, 2, 2, 2])
        self.assertEqual(clan.supabase_data["bosslaps"], [1, 1, 2, 2, 2])

    async def test_setboss_fills_unappeared_boss_with_1_based_lap(self) -> None:
        clan, _member, supabase = self.create_clan()
        clan.TemporaryMessage = MagicMock()
        clan.OnChangeBoss = AsyncMock()

        self.assertTrue(await clan.SetBoss(self.create_message(), MagicMock(), "5 4 0 0 4"))

        supabase.update_clan_bosslaps.assert_called_once_with(123, [5, 4, 6, 6, 4])

    async def test_undefeat_does_not_go_below_lap_1(self) -> None:
        clan, _member, supabase = self.create_clan()
        clan.TemporaryMessage = MagicMock()
        clan.OnChangeBoss = AsyncMock()

        self.assertFalse(await clan.Undefeat(self.create_message(), MagicMock(), "1"))

        supabase.update_clan_bosslaps.assert_not_called()
        self.assertEqual(clan.supabase_data["bosslaps"], [1, 1, 1, 1, 1])

    def test_status_boss_shows_bosslaps_as_stored(self) -> None:
        clan, _member, _supabase = self.create_clan()
        clan.supabase_data = {"bosslaps": [2, 2, 3, 3, 2]}
        marks = clan.numbermarks

        self.assertEqual(
            clan.StatusBoss(),
            f"ボス情報 2周 {marks[1]} {marks[2]} {marks[5]} / 3周 {marks[3]} {marks[4]} 7周から3段階目\n",
        )

    def test_status_boss_hides_next_lap_before_level_up(self) -> None:
        clan, _member, _supabase = self.create_clan()
        clan.supabase_data = {"bosslaps": [6, 7, 6, 6, 6]}
        marks = clan.numbermarks

        self.assertEqual(
            clan.StatusBoss(),
            f"ボス情報 6周 {marks[1]} {marks[3]} {marks[4]} {marks[5]} 7周から3段階目\n",
        )

    async def test_setmember_rejects_non_administrator(self) -> None:
        clan, _member, supabase = self.create_clan()
        clan.TemporaryMessage = MagicMock()
        clan.CheckNotAdministrator = MagicMock(return_value=True)

        self.assertFalse(await clan.SetMember(self.create_setmember_message([]), MagicMock(), "クランメンバー"))

        supabase.insert_discord_clan_member_if_missing.assert_not_called()

    def test_damage_update_only_changes_target_clan(self) -> None:
        client = SupabaseClient("https://example.invalid", "dummy")
        rows = [
            {"clanid": "999", "memberid": "456", "attackdata": {"boss": 5, "sortie": 3, "damage": 7}},
            {"clanid": "123", "memberid": "456", "attackdata": {"boss": 2, "sortie": 1, "damage": 8}},
        ]
        untouched = json.loads(json.dumps(rows[0]))

        def request(req, timeout):
            query = parse_qs(urlsplit(req.full_url).query)
            self.assertEqual(query.get("clanid"), ["eq.123"])
            self.assertEqual(query.get("memberid"), ["eq.456"])
            matched = [row for row in rows if all(
                query.get(key, ["eq." + row[key]])[0] == "eq." + row[key]
                for key in ("clanid", "memberid")
            )]
            if req.get_method() == "PATCH":
                for row in matched:
                    row.update(json.loads(req.data))
                return io.BytesIO(b"")
            return io.BytesIO(json.dumps(matched[:1]).encode())

        with patch("src.nextbot.supabase_client.urlopen", side_effect=request):
            client.update_clan_member_damage_message(123, "456", 500, "updated")

        self.assertEqual(rows[0], untouched)
        self.assertEqual(rows[1]["attackdata"]["boss"], 2)
        self.assertEqual(rows[1]["attackdata"]["sortie"], 1)
        self.assertEqual(rows[1]["attackdata"]["damage"], 500)
        self.assertEqual(rows[1]["attackdata"]["message"], "updated")

    async def test_member_reload_preserves_attack_reaction_and_undo(self) -> None:
        clan, member, supabase = self.create_clan()
        message = self.create_message()
        member.Attack(5, 1)
        member.attackmessage = message
        reportlimit = member.reportlimit
        clan.RemoveReaction = AsyncMock()
        reaction = clan.CreateAttackReaction(member, message, 5, 1, 0)
        clan.messagereaction[message.id] = reaction
        supabase.get_clan_members.return_value = [{
            "memberid": "456", "name": "updated", "mention": "<@456>",
            "attacktime": [None, None, None], "attackdata": {"boss": 5, "sortie": 1},
        }, {"memberid": "789", "name": "new member"}]
        members = clan.members
        await clan.ReloadSupabaseMembers()
        self.assertIs(clan.members, members)
        self.assertIs(clan.GetMember(456), member)
        self.assertIs(member.attackmessage, message)
        self.assertEqual(member.reportlimit, reportlimit)
        self.assertEqual(member.name, "updated")
        self.assertIn("789", clan.members)
        supabase.finish_clan_member_attack.return_value = {
            "history_id": None, "attacktime": [None, None, None],
            "attackdata": {"boss": 0, "sortie": 0}, "bosslaps": [1] * 5,
        }
        payload = types.SimpleNamespace(user_id=456, message_id=message.id,
                                        emoji=types.SimpleNamespace(name=clan.emojis[9]))
        self.assertTrue(await clan.OnRawReactionAdd(payload))
        supabase.finish_clan_member_attack.assert_called_once()
        self.assertFalse(member.IsAttack())
        self.assertTrue(await clan.OnRawReactionRemove(payload))
        self.assertTrue(member.IsAttack())
        supabase.update_discord_clan_member_attack.assert_called_once()

    def test_member_reload_removes_absent_members_without_replacing_dictionary(self) -> None:
        clan, member, _ = self.create_clan()
        clan.members["removed"] = ClanMember("removed")
        members = clan.members
        clan.LoadSupabaseMembers([{"memberid": 456, "name": "updated"}])
        self.assertIs(clan.members, members)
        self.assertEqual(set(clan.members), {"456"})
        self.assertIs(clan.GetMember(456), member)
        self.assertIs(clan.damagecontrol[0].clanmembers, members)
        clan.LoadSupabaseMembers([])
        self.assertEqual(members, {})

    async def test_attack_reminder_uses_jst_and_notifies_once_after_deadline(self) -> None:
        clan, member, _ = self.create_clan()
        now = datetime.datetime(2026, 9, 17, 12, 0, tzinfo=constants.JST)
        clan.SendNotice = AsyncMock()
        with patch("src.nextbot.constants.now_jst", return_value=now):
            member.Attack(1, 1)
        self.assertEqual(member.reportlimit, now + datetime.timedelta(minutes=30))
        await clan.RequestResult(now + datetime.timedelta(minutes=29))
        clan.SendNotice.assert_not_awaited()
        await clan.RequestResult(now + datetime.timedelta(minutes=31))
        await clan.RequestResult(now + datetime.timedelta(minutes=32))
        clan.SendNotice.assert_awaited_once_with("<@456> 凸結果の報告をお願いします")
        self.assertIsNone(member.reportlimit)

    def test_reference_date_changes_at_five_am_jst(self) -> None:
        jst = datetime.timezone(datetime.timedelta(hours=9))

        self.assertEqual(
            constants.reference_date(datetime.datetime(2026, 9, 8, 4, 59, tzinfo=jst)),
            "2026-09-07",
        )
        self.assertEqual(
            constants.reference_date(datetime.datetime(2026, 9, 8, 5, 0, tzinfo=jst)),
            "2026-09-08",
        )

    def test_reference_date_converts_aware_datetime_to_jst(self) -> None:
        self.assertEqual(
            constants.reference_date(
                datetime.datetime(2026, 9, 7, 20, 0, tzinfo=datetime.timezone.utc)
            ),
            "2026-09-08",
        )

    async def test_one_digit_attack_uses_the_number_as_boss(self) -> None:
        clan, member, supabase = self.create_clan()
        message = self.create_message()

        result = await clan.Attack(message, self.create_discord_member(), "5")

        self.assertTrue(result)
        self.assertEqual((member.boss, member.sortie), (5, 1))
        supabase.update_discord_clan_member_attack.assert_called_once_with(
            123, 456, "new name", "<@456>", 5, 1, 1, 0, constants.reference_date()
        )
        clan.AddReaction.assert_awaited_once_with(message, False)

    async def test_two_digit_attack_uses_carry_over_sortie(self) -> None:
        clan, member, supabase = self.create_clan([None, 50, None])
        message = self.create_message()

        result = await clan.Attack(message, self.create_discord_member(), "52")

        self.assertTrue(result)
        self.assertEqual((member.boss, member.sortie), (5, 2))
        supabase.update_discord_clan_member_attack.assert_called_once_with(
            123, 456, "new name", "<@456>", 5, 1, 2, 1, constants.reference_date()
        )
        clan.AddReaction.assert_awaited_once_with(message, True)

    async def test_two_digit_attack_rejects_non_carry_over_sortie(self) -> None:
        clan, member, supabase = self.create_clan()
        message = self.create_message()
        clan.TemporaryMessage = MagicMock()

        result = await clan.Attack(message, self.create_discord_member(), "52")

        self.assertFalse(result)
        self.assertFalse(member.IsAttack())
        supabase.update_discord_clan_member_attack.assert_not_called()
        clan.TemporaryMessage.assert_called_once_with(message.channel, "持ち越しではありません")

    async def test_database_failure_does_not_start_local_attack(self) -> None:
        clan, member, supabase = self.create_clan()
        message = self.create_message()
        clan.TemporaryMessage = MagicMock()
        supabase.update_discord_clan_member_attack.side_effect = RuntimeError("database error")

        result = await clan.Attack(message, self.create_discord_member(), "5")

        self.assertFalse(result)
        self.assertFalse(member.IsAttack())
        clan.AddReaction.assert_not_awaited()
        self.assertNotIn(message.id, clan.messagereaction)
        clan.TemporaryMessage.assert_called_once_with(
            message.channel, "攻撃の開始に失敗しました: database error"
        )

    async def test_normal_defeat_reaction_finishes_attack(self) -> None:
        clan, member, supabase = self.create_clan()
        message = self.create_message()
        member.Attack(5, 1)
        member.attackmessage = message
        supabase.finish_clan_member_attack.return_value = {
            "history_id": 77,
            "attacktime": [20, None, None],
            "attackdata": {"day": "", "sortie": 0, "lap": 0, "boss": 0},
            "bosslaps": [1, 1, 1, 1, 2],
        }
        supabase.refresh_clan_member_attacktime.return_value = [20, None, None]
        clan.RemoveReaction = AsyncMock()
        reaction = clan.CreateAttackReaction(member, message, 5, 1, 0)
        payload = types.SimpleNamespace(
            message_id=message.id,
            emoji=types.SimpleNamespace(name=clan.emojis[1]),
        )

        result = await reaction.addreaction(member, payload)

        self.assertTrue(result)
        supabase.finish_clan_member_attack.assert_called_once_with(
            "456", "old name", "<@456>", 100, "defeat", 20, 123
        )
        self.assertEqual(member.attacktime, [20, None, None])
        self.assertFalse(member.IsAttack())
        self.assertEqual(reaction.history_id, 77)
        self.assertEqual(clan.supabase_data["bosslaps"], [1, 1, 1, 1, 2])

    async def test_carry_over_zero_reaction_maps_to_defeat(self) -> None:
        clan, member, supabase = self.create_clan([None, 50, None])
        message = self.create_message()
        member.Attack(5, 2)
        member.attackmessage = message
        supabase.finish_clan_member_attack.return_value = {
            "history_id": 78,
            "attacktime": [None, 0, None],
            "attackdata": {"day": "", "sortie": 0, "lap": 0, "boss": 0},
            "bosslaps": [1, 1, 1, 1, 2],
        }
        supabase.refresh_clan_member_attacktime.return_value = [None, 0, None]
        clan.RemoveReaction = AsyncMock()
        reaction = clan.CreateAttackReaction(member, message, 5, 2, 50)
        payload = types.SimpleNamespace(
            message_id=message.id,
            emoji=types.SimpleNamespace(name=clan.numbermarks[0]),
        )

        result = await reaction.addreaction(member, payload)

        self.assertTrue(result)
        supabase.finish_clan_member_attack.assert_called_once_with(
            "456", "old name", "<@456>", 100, "defeat", 0, 123
        )
        self.assertEqual(member.attacktime, [None, 0, None])

    async def test_reaction_remove_reverts_by_history_id(self) -> None:
        clan, member, supabase = self.create_clan()
        message = self.create_message()
        member.Attack(5, 1)
        member.attackmessage = message
        supabase.finish_clan_member_attack.return_value = {
            "history_id": 79,
            "attacktime": [20, None, None],
            "attackdata": {"day": "", "sortie": 0, "lap": 0, "boss": 0},
            "bosslaps": [1, 1, 1, 1, 2],
        }
        supabase.revert_clan_member_attack.return_value = {
            "attacktime": [None, None, None],
            "attackdata": {
                "day": "2026-09-05", "sortie": 1, "lap": 1, "boss": 5, "overattack": 0
            },
            "bosslaps": [1, 1, 1, 1, 1],
        }
        clan.RemoveReaction = AsyncMock()
        reaction = clan.CreateAttackReaction(member, message, 5, 1, 0)
        payload = types.SimpleNamespace(
            message_id=message.id,
            emoji=types.SimpleNamespace(name=clan.emojis[1]),
        )
        await reaction.addreaction(member, payload)

        result = await reaction.removereaction(member, payload)

        self.assertTrue(result)
        supabase.revert_clan_member_attack.assert_called_once_with("456", 79)
        self.assertTrue(member.IsAttack())
        self.assertEqual((member.boss, member.sortie), (5, 1))
        self.assertEqual(clan.supabase_data["bosslaps"], [1, 1, 1, 1, 1])
        clan.AddReaction.assert_awaited_once_with(message, False)

    async def test_cancel_reaction_remove_restores_attack_without_history(self) -> None:
        clan, member, supabase = self.create_clan([None, 50, None])
        message = self.create_message()
        member.Attack(5, 2)
        member.attackmessage = message
        supabase.finish_clan_member_attack.return_value = {
            "history_id": None,
            "attacktime": [None, 50, None],
            "attackdata": {"day": "", "sortie": 0, "lap": 0, "boss": 0},
            "bosslaps": [1, 1, 1, 1, 1],
        }
        clan.RemoveReaction = AsyncMock()
        reaction = clan.CreateAttackReaction(member, message, 5, 2, 50)
        payload = types.SimpleNamespace(
            message_id=message.id,
            emoji=types.SimpleNamespace(name=clan.emojis[9]),
        )
        await reaction.addreaction(member, payload)

        result = await reaction.removereaction(member, payload)

        self.assertTrue(result)
        self.assertTrue(member.IsAttack())
        self.assertEqual((member.boss, member.sortie), (5, 2))
        supabase.revert_clan_member_attack.assert_not_called()
        supabase.update_discord_clan_member_attack.assert_called_once_with(
            123, "456", "old name", "<@456>", 5, 1, 2, 1, constants.reference_date()
        )
        clan.AddReaction.assert_awaited_once_with(message, True)

    async def test_cancel_reaction_finishes_attack(self) -> None:
        clan, member, supabase = self.create_clan()
        message = self.create_message()
        member.Attack(5, 1)
        member.attackmessage = message
        clan.TemporaryMessage = MagicMock()
        clan.RemoveReaction = AsyncMock()
        clan.damagecontrol[4].Remove = AsyncMock()
        clan.damagecontrol[4].SendResult = AsyncMock()
        supabase.finish_clan_member_attack.return_value = {
            "history_id": None,
            "attacktime": [None, None, None],
            "attackdata": {"day": "", "sortie": 0, "lap": 0, "boss": 0},
            "bosslaps": [1, 1, 1, 1, 1],
        }
        reaction = clan.CreateAttackReaction(member, message, 5, 1, 0)
        payload = types.SimpleNamespace(
            message_id=message.id,
            emoji=types.SimpleNamespace(name=clan.emojis[9]),
        )

        result = await reaction.addreaction(member, payload)

        self.assertTrue(result)
        supabase.finish_clan_member_attack.assert_called_once_with(
            "456", "old name", "<@456>", 100, "cancel", 0, 123
        )
        self.assertFalse(member.IsAttack())
        clan.damagecontrol[4].Remove.assert_awaited_once_with(member)

    async def test_cancel_command_finishes_attack(self) -> None:
        clan, member, supabase = self.create_clan()
        message = self.create_message()
        member.Attack(5, 1)
        member.attackmessage = message
        clan.TemporaryMessage = MagicMock()
        clan.RemoveReaction = AsyncMock()
        clan.damagecontrol[4].Remove = AsyncMock()
        clan.damagecontrol[4].SendResult = AsyncMock()
        supabase.finish_clan_member_attack.return_value = {
            "history_id": None,
            "attacktime": [None, None, None],
            "attackdata": {"day": "", "sortie": 0, "lap": 0, "boss": 0},
            "bosslaps": [1, 1, 1, 1, 1],
        }

        result = await clan.Cancel(message, self.create_discord_member(), "")

        self.assertTrue(result)
        supabase.finish_clan_member_attack.assert_called_once_with(
            "456", "old name", "<@456>", 100, "cancel", 0, 123
        )
        self.assertFalse(member.IsAttack())
        clan.TemporaryMessage.assert_called_once_with(message.channel, "攻撃をキャンセルしました")

    def test_update_discord_clan_member_attack_filters_by_clanid(self) -> None:
        client = SupabaseClient("https://example.supabase.co", "secret")
        get_response = MagicMock()
        get_response.__enter__.return_value = get_response
        patch_response = MagicMock()
        patch_response.__enter__.return_value = patch_response

        with patch("src.nextbot.supabase_client.urlopen", side_effect=[get_response, patch_response]) as mocked_urlopen:
            with patch(
                "src.nextbot.supabase_client.json.load",
                side_effect=[[{"attackdata": {"day": "", "boss": 0}}], [{"memberid": "456"}]],
            ):
                client.update_discord_clan_member_attack(
                    123, 456, "name", "<@456>", 5, 1, 1, 0, "2026-09-12"
                )

        get_request = mocked_urlopen.call_args_list[0].args[0]
        patch_request = mocked_urlopen.call_args_list[1].args[0]
        self.assertIn("clanid=eq.123", get_request.full_url)
        self.assertIn("memberid=eq.456", get_request.full_url)
        self.assertIn("clanid=eq.123", patch_request.full_url)
        self.assertIn("memberid=eq.456", patch_request.full_url)
        payload = json.loads(patch_request.data)
        self.assertEqual(payload["day"], "2026-09-12")
        self.assertEqual(payload["attackdata"]["day"], "2026-09-12")
        self.assertEqual(payload["attackdata"]["boss"], 5)
        self.assertEqual(payload["attackdata"]["sortie"], 1)

    def test_finish_clan_member_attack_sends_clanid(self) -> None:
        client = SupabaseClient("https://example.supabase.co", "secret")

        with patch("src.nextbot.supabase_client.urlopen") as mocked_urlopen:
            mocked_urlopen.return_value.__enter__.return_value = MagicMock()
            with patch(
                "src.nextbot.supabase_client.json.load",
                return_value={"attackdata": {"boss": 0}, "attacktime": [None, None, None]},
            ):
                client.finish_clan_member_attack("456", "name", "<@456>", 100, "cancel", 0, 123)

        called_request = mocked_urlopen.call_args.args[0]
        self.assertIn("/rpc/finish_clan_member_attack", called_request.full_url)
        self.assertEqual(json.loads(called_request.data)["p_clanid"], "123")
        self.assertEqual(json.loads(called_request.data)["p_action"], "cancel")

    async def test_setting_reload_updates_clanbattle_setting(self) -> None:
        clan, _, supabase = self.create_clan()
        message = cast(discord.Message, self.create_message())
        discord_member = cast(discord.Member, self.create_discord_member())
        clan.TemporaryMessage = MagicMock()
        setting: dict[str, Any] = {"id": 0, "yearmonth": "202609"}
        supabase.get_clanbattle_setting.return_value = setting

        result = await clan.SettingReload(message, discord_member, "")

        self.assertTrue(result)
        self.assertIs(clan.clanbattle_setting, setting)
        supabase.get_clanbattle_setting.assert_called_once_with()
        clan.TemporaryMessage.assert_called_once_with(message.channel, "設定を再読み込みしました")

    async def test_setting_reload_keeps_current_setting_on_failure(self) -> None:
        clan, _, supabase = self.create_clan()
        message = cast(discord.Message, self.create_message())
        discord_member = cast(discord.Member, self.create_discord_member())
        clan.TemporaryMessage = MagicMock()
        current_setting: dict[str, Any] = {"id": 0, "yearmonth": "202608"}
        clan.clanbattle_setting = current_setting
        supabase.get_clanbattle_setting.side_effect = RuntimeError("database error")

        result = await clan.SettingReload(message, discord_member, "")

        self.assertFalse(result)
        self.assertIs(clan.clanbattle_setting, current_setting)
        clan.TemporaryMessage.assert_called_once_with(
            message.channel, "設定の再読み込みに失敗しました: database error"
        )

    async def test_taskkill_sets_current_base_date(self) -> None:
        clan, clan_member, supabase = self.create_clan()
        message = cast(discord.Message, self.create_message())
        discord_member = cast(discord.Member, self.create_discord_member())

        result = await clan.TaskKill(message, discord_member, "")

        self.assertTrue(result)
        self.assertEqual(clan_member.taskkill, constants.reference_date())
        supabase.update_clan_member_taskkill.assert_called_once_with(
            123, "456", constants.reference_date()
        )
        message.add_reaction.assert_awaited_once_with(clan.taskkillmark)

    def test_get_member_accepts_discord_integer_id_for_string_key(self) -> None:
        clan = Clan()
        member = ClanMember("456")
        clan.members[member.id] = member

        self.assertIs(clan.GetMember(456), member)
        self.assertIs(clan.GetMember("456"), member)

    def test_apply_supabase_member_preserves_web_member_id(self) -> None:
        clan = Clan()

        clan.ApplySupabaseMember({
            "memberid": "w00000001",
            "name": "Web member",
            "mention": "",
            "attacktime": [],
            "attackdata": {"day": "", "sortie": 0, "lap": 0, "boss": 0},
        })

        self.assertIn("w00000001", clan.members)
        self.assertEqual(clan.members["w00000001"].id, "w00000001")

    async def test_taskkill_database_failure_does_not_update_member(self) -> None:
        clan, clan_member, supabase = self.create_clan()
        message = cast(discord.Message, self.create_message())
        discord_member = cast(discord.Member, self.create_discord_member())
        clan.TemporaryMessage = MagicMock()
        supabase.update_clan_member_taskkill.side_effect = RuntimeError("database error")

        result = await clan.TaskKill(message, discord_member, "")

        self.assertFalse(result)
        self.assertEqual(clan_member.taskkill, "")
        message.add_reaction.assert_not_awaited()
        clan.TemporaryMessage.assert_called_once_with(
            message.channel, "タスキルの更新に失敗しました: database error"
        )

    def test_clan_member_loads_taskkill_date(self) -> None:
        clan_member = ClanMember("456")

        clan_member.ApplyDatabaseRow({"taskkill": "2026-09-08"})

        self.assertEqual(clan_member.taskkill, "2026-09-08")

    def test_taskkill_display_only_applies_to_matching_base_date(self) -> None:
        clan_member = ClanMember("456")
        clan_member.name = "member"
        clan_member.taskkill = "2000-01-01"

        self.assertEqual(clan_member.DecoName("nT", "2026-09-08"), "member")

        clan_member.taskkill = "2026-09-08"
        self.assertEqual(clan_member.DecoName("nT", "2026-09-08"), "member[tk]")

    async def test_save_discord_data_uses_damage_control_channel_ids(self) -> None:
        clan, _, supabase = self.create_clan()
        channel = cast(discord.TextChannel, types.SimpleNamespace(id=987))
        clan.damagecontrol[1].SetChannel(channel)

        await clan.SaveDiscordData()

        supabase.update_clan_discord_data.assert_called_once_with(
            123,
            {"damagecontrol": [0, 987, 0, 0, 0]},
        )

    def test_update_clan_discord_data_patches_jsonb_column(self) -> None:
        client = SupabaseClient("https://example.supabase.co", "secret")

        with patch("src.nextbot.supabase_client.urlopen") as mocked_urlopen:
            client.update_clan_discord_data(
                123,
                {"damagecontrol": [0, 987, 0, 0, 0]},
            )

        request = mocked_urlopen.call_args.args[0]
        self.assertEqual(request.method, "PATCH")
        self.assertIn("clanid=eq.123", request.full_url)
        self.assertEqual(
            json.loads(request.data),
            {"discord_data": {"damagecontrol": [0, 987, 0, 0, 0]}},
        )

    def test_apply_discord_data_restores_damage_control_channels(self) -> None:
        guild = MagicMock(spec=discord.Guild)
        text_channel = MagicMock(spec=discord.TextChannel)
        voice_channel = MagicMock(spec=discord.VoiceChannel)
        guild.get_channel.side_effect = {
            111: text_channel,
            222: voice_channel,
        }.get
        clan = Clan(guild=guild)

        clan.ApplyDiscordData({"damagecontrol": [111, 0, 999, 222, 111]})

        self.assertIs(clan.damagecontrol[0].channel, text_channel)
        self.assertIsNone(clan.damagecontrol[1].channel)
        self.assertIsNone(clan.damagecontrol[2].channel)
        self.assertIsNone(clan.damagecontrol[3].channel)
        self.assertIs(clan.damagecontrol[4].channel, text_channel)
        guild.get_channel.assert_any_call(111)
        guild.get_channel.assert_any_call(999)

    async def test_on_message_calls_damage_handler_for_configured_channel(self) -> None:
        clan = Clan(input_channel_name="凸報告")
        channel = MagicMock(spec=discord.TextChannel)
        clan.damagecontrol[0].SetChannel(channel)
        clan.OnMessageDamageChannel = AsyncMock()
        message = MagicMock(spec=discord.Message)
        message.channel = channel
        message.content = "1000"
        message.guild = MagicMock(spec=discord.Guild)
        message.raw_mentions = []
        message.raw_role_mentions = []
        member = MagicMock(spec=discord.Member)

        handled = await clan.on_message(message, member, None)

        self.assertFalse(handled)
        clan.OnMessageDamageChannel.assert_awaited_once_with(message, member)

    async def test_on_message_ignores_unconfigured_channel_for_damage_handler(self) -> None:
        clan = Clan(input_channel_name="凸報告")
        configured_channel = MagicMock(spec=discord.TextChannel)
        other_channel = MagicMock(spec=discord.TextChannel)
        clan.damagecontrol[0].SetChannel(configured_channel)
        clan.OnMessageDamageChannel = AsyncMock()
        message = MagicMock(spec=discord.Message)
        message.channel = other_channel
        message.content = "1000"
        message.guild = MagicMock(spec=discord.Guild)
        message.raw_mentions = []
        message.raw_role_mentions = []
        member = MagicMock(spec=discord.Member)

        handled = await clan.on_message(message, member, None)

        self.assertFalse(handled)
        clan.OnMessageDamageChannel.assert_not_awaited()

    async def test_register_guild_applies_loaded_discord_data(self) -> None:
        app = NextBotApp.__new__(NextBotApp)
        app.supabase = MagicMock()
        app.supabase.register_clan_if_missing.return_value = False
        supabase_data = {
            "clanid": "123",
            "discord_data": {"damagecontrol": [111, 0, 0, 0, 0]},
        }
        app.supabase.get_clan.return_value = supabase_data
        app.supabase.get_clan_members.return_value = []
        app.supabase.get_attack_overtimes.return_value = []
        clan = Clan()
        clan.ApplyDiscordData = MagicMock()
        app._get_clan = MagicMock(return_value=clan)
        guild = MagicMock(spec=discord.Guild)
        guild.id = 123
        guild.name = "test guild"

        await app._register_guild(guild)

        clan.ApplyDiscordData.assert_called_once_with(supabase_data["discord_data"])

    async def test_register_guild_applies_attack_overtimes_from_histories(self) -> None:
        app = NextBotApp.__new__(NextBotApp)
        app.supabase = MagicMock()
        app.supabase.register_clan_if_missing.return_value = False
        app.supabase.get_clan.return_value = {"clanid": "123", "discord_data": {}}
        app.supabase.get_clan_members.return_value = [
            {
                "memberid": "456",
                "name": "member",
                "mention": "<@456>",
                "attacktime": [],
                "attackdata": {"day": "", "sortie": 0, "lap": 0, "boss": 0},
            }
        ]
        app.supabase.get_attack_overtimes.return_value = [
            {
                "clanid": "123",
                "memberid": "456",
                "day": constants.reference_date(),
                "maxsortie": 2,
                "overtime_1": 50,
                "overtime_2": 0,
                "overtime_3": 0,
            }
        ]
        clan = Clan(clan_id=123)
        clan.ApplyDiscordData = MagicMock()
        app._get_clan = MagicMock(return_value=clan)
        guild = MagicMock(spec=discord.Guild)
        guild.id = 123
        guild.name = "test guild"

        await app._register_guild(guild)

        app.supabase.get_attack_overtimes.assert_called_once_with(constants.reference_date(), 123)
        self.assertEqual(clan.members["456"].attacktime, [50, 0, None])

    def test_aggregate_attack_overtimes_matches_sql(self) -> None:
        rows = [
            {"clanid": "1", "memberid": "a", "day": "2026-09-11", "sortie": 1, "overtime": 50},
            {"clanid": "1", "memberid": "a", "day": "2026-09-11", "sortie": 2, "overtime": 0},
            {"clanid": "1", "memberid": "b", "day": "2026-09-11", "sortie": 1, "overtime": 20},
            {"clanid": "1", "memberid": "b", "day": "2026-09-11", "sortie": 1, "overtime": 30},
        ]

        result = {
            row["memberid"]: row
            for row in SupabaseClient.aggregate_attack_overtimes(rows)
        }

        self.assertEqual(result["a"]["maxsortie"], 2)
        self.assertEqual(result["a"]["overtime_1"], 50)
        self.assertEqual(result["a"]["overtime_2"], 0)
        self.assertEqual(result["a"]["overtime_3"], 0)
        self.assertEqual(result["b"]["maxsortie"], 1)
        self.assertEqual(result["b"]["overtime_1"], 0)
        self.assertEqual(result["b"]["overtime_2"], 0)
        self.assertEqual(result["b"]["overtime_3"], 0)

    def test_build_attacktime_from_histories_matches_sql(self) -> None:
        self.assertEqual(
            SupabaseClient.build_attacktime_from_histories(
                [
                    {"sortie": 1, "overtime": 50},
                    {"sortie": 2, "overtime": 0},
                ]
            ),
            [50, 0, None],
        )
        self.assertEqual(
            SupabaseClient.build_attacktime_from_histories(
                [
                    {"sortie": 1, "overtime": 20},
                    {"sortie": 1, "overtime": 30},
                ]
            ),
            [0, None, None],
        )

    async def test_finish_attack_refreshes_attacktime_with_reference_date(self) -> None:
        clan, member, supabase = self.create_clan()
        message = self.create_message()
        member.Attack(5, 1)
        member.attackmessage = message
        supabase.finish_clan_member_attack.return_value = {
            "history_id": 77,
            "attacktime": [0, None, None],
            "attackdata": {"day": "", "sortie": 0, "lap": 0, "boss": 0},
            "bosslaps": [1, 1, 1, 1, 2],
        }
        supabase.refresh_clan_member_attacktime.return_value = [50, None, None]
        clan.RemoveReaction = AsyncMock()
        reaction = clan.CreateAttackReaction(member, message, 5, 1, 0)
        payload = types.SimpleNamespace(
            message_id=message.id,
            emoji=types.SimpleNamespace(name=clan.emojis[1]),
        )

        result = await reaction.addreaction(member, payload)

        self.assertTrue(result)
        supabase.refresh_clan_member_attacktime.assert_called_once_with(
            123, "456", constants.reference_date()
        )
        self.assertEqual(member.attacktime, [50, None, None])

    async def test_cancel_attack_does_not_refresh_attacktime_from_histories(self) -> None:
        clan, member, supabase = self.create_clan()
        message = self.create_message()
        member.Attack(5, 1)
        member.attackmessage = message
        clan.TemporaryMessage = MagicMock()
        clan.RemoveReaction = AsyncMock()
        clan.damagecontrol[4].Remove = AsyncMock()
        clan.damagecontrol[4].SendResult = AsyncMock()
        supabase.finish_clan_member_attack.return_value = {
            "history_id": None,
            "attacktime": [None, None, None],
            "attackdata": {"day": "", "sortie": 0, "lap": 0, "boss": 0},
            "bosslaps": [1, 1, 1, 1, 1],
        }
        reaction = clan.CreateAttackReaction(member, message, 5, 1, 0)
        payload = types.SimpleNamespace(
            message_id=message.id,
            emoji=types.SimpleNamespace(name=clan.emojis[9]),
        )

        result = await reaction.addreaction(member, payload)

        self.assertTrue(result)
        supabase.refresh_clan_member_attacktime.assert_not_called()

    def test_apply_attack_overtimes_sets_none_beyond_maxsortie(self) -> None:
        clan = Clan(clan_id=123)
        clan.ApplySupabaseMember({
            "memberid": "456",
            "name": "member",
            "mention": "",
            "attacktime": [None, None, None],
            "attackdata": {"day": "", "sortie": 0, "lap": 0, "boss": 0},
        })

        clan.ApplyAttackOvertimes([
            {
                "clanid": "123",
                "memberid": "456",
                "day": "2026-09-11",
                "maxsortie": 1,
                "overtime_1": 40,
                "overtime_2": 0,
                "overtime_3": 0,
            },
            {
                "clanid": "999",
                "memberid": "456",
                "day": "2026-09-11",
                "maxsortie": 3,
                "overtime_1": 10,
                "overtime_2": 20,
                "overtime_3": 30,
            },
        ])

        self.assertEqual(clan.members["456"].attacktime, [40, None, None])

    def test_find_channel_normalizes_visible_name(self) -> None:
        clan = Clan()
        channel = types.SimpleNamespace(name="\u3000状況報告\u3000")
        guild = types.SimpleNamespace(text_channels=[channel])

        result = clan.FindChannel(guild, "状況報告")

        self.assertIs(result, channel)

    async def test_clan_member_realtime_insert_and_delete(self) -> None:
        guild = MagicMock()
        clan = Clan(guild=guild)
        clan.OnMessageHandled = AsyncMock()
        row = {"clanid": "123", "memberid": "456", "name": "member"}

        await clan.OnSupabaseUpdateClanMembers({}, row)
        self.assertIn("456", clan.members)
        clan.OnMessageHandled.assert_awaited_once_with(guild)

        clan.OnMessageHandled.reset_mock()
        await clan.OnSupabaseUpdateClanMembers(row, {})
        self.assertNotIn("456", clan.members)
        clan.OnMessageHandled.assert_awaited_once_with(guild)

    @staticmethod
    def create_status_clan() -> tuple[Clan, MagicMock]:
        clan = Clan(guild=MagicMock())
        channel = MagicMock()
        channel.send = AsyncMock(return_value=MagicMock(delete=AsyncMock()))
        clan.FindChannel = MagicMock(return_value=channel)
        return clan, channel

    async def test_status_update_during_post_is_not_dropped(self) -> None:
        clan, channel = self.create_status_clan()
        statuses = iter(["status-1", "status-2"])
        clan.Status = MagicMock(side_effect=lambda: next(statuses))
        release = asyncio.Event()
        send_started = asyncio.Event()

        async def slow_send(text: str) -> MagicMock:
            if not send_started.is_set():
                send_started.set()
                await release.wait()
            return MagicMock(delete=AsyncMock())

        channel.send = AsyncMock(side_effect=slow_send)

        first = asyncio.create_task(clan.OnMessageHandled(clan.guild))
        await send_started.wait()
        await clan.OnMessageHandled(clan.guild)
        release.set()
        await first

        self.assertEqual([call.args[0] for call in channel.send.await_args_list], ["status-1", "status-2"])

    async def test_status_update_recovers_after_delete_failure(self) -> None:
        clan, channel = self.create_status_clan()
        clan.Status = MagicMock(return_value="status")
        clan.lastmessage = MagicMock(delete=AsyncMock(side_effect=RuntimeError("discord 503")))

        await clan.OnMessageHandled(clan.guild)
        channel.send.assert_not_awaited()

        clan.lastmessage = None
        await clan.OnMessageHandled(clan.guild)
        channel.send.assert_awaited_once_with("status")

    @staticmethod
    def create_damage_control(text: list[str]) -> tuple[DamageControl, MagicMock, list[MagicMock]]:
        dc = DamageControl({}, 0)
        dc.active = True
        dc.Status = MagicMock(side_effect=lambda: text[0])
        posted: list[MagicMock] = []
        channel = MagicMock()

        async def send(mes: str) -> MagicMock:
            post = MagicMock(delete=AsyncMock())
            posted.append(post)
            return post

        channel.send = AsyncMock(side_effect=send)
        dc.SetChannel(channel)
        return dc, channel, posted

    async def test_damage_control_update_during_post_is_not_dropped(self) -> None:
        text = ["A 300"]
        dc, channel, _posted = self.create_damage_control(text)
        release = asyncio.Event()
        original_send = channel.send.side_effect

        async def slow_send(mes: str) -> MagicMock:
            if channel.send.await_count == 1:
                text[0] = "A 300 / B 500"
                await dc.SendResult()
                await release.wait()
            return await original_send(mes)

        channel.send.side_effect = slow_send
        first = asyncio.create_task(dc.SendResult())
        await asyncio.sleep(0)
        release.set()
        await first

        self.assertEqual([call.args[0] for call in channel.send.await_args_list], ["A 300", "A 300 / B 500"])

    async def test_damage_control_finish_waits_for_post_and_cleans_up(self) -> None:
        text = ["A 300"]
        dc, channel, posted = self.create_damage_control(text)
        dc.Damage(ClanMember("1"), 300)
        release = asyncio.Event()
        original_send = channel.send.side_effect

        async def slow_send(mes: str) -> MagicMock:
            if channel.send.await_count == 1:
                await release.wait()
            return await original_send(mes)

        channel.send.side_effect = slow_send
        first = asyncio.create_task(dc.SendResult())
        await asyncio.sleep(0)
        finish = asyncio.create_task(dc.SendFinish("討伐お疲れさまです"))
        await asyncio.sleep(0)
        release.set()
        await asyncio.gather(first, finish)

        self.assertEqual([call.args[0] for call in channel.send.await_args_list], ["A 300", "討伐お疲れさまです"])
        posted[0].delete.assert_awaited_once()
        posted[1].delete.assert_not_awaited()
        self.assertIsNone(dc.lastmessage)
        self.assertFalse(dc.active)
        self.assertEqual(dc.members, {})

    async def test_damage_control_recovers_after_delete_failure(self) -> None:
        dc, channel, _posted = self.create_damage_control(["status"])
        dc.lastmessage = MagicMock(delete=AsyncMock(side_effect=RuntimeError("discord 503")))

        await dc.SendResult()
        channel.send.assert_not_awaited()

        dc.lastmessage = None
        await dc.SendResult()
        channel.send.assert_awaited_once_with("status")

    async def test_resync_members_posts_status_only_when_changed(self) -> None:
        clan, _member, supabase = self.create_clan()
        clan.guild = MagicMock()
        clan.OnMessageHandled = AsyncMock()
        row = {"clanid": "123", "memberid": "456", "name": "old name", "mention": "<@456>", "attacktime": []}
        supabase.get_clan_members.return_value = [row]

        await clan.ResyncSupabaseMembers()
        clan.OnMessageHandled.assert_not_awaited()

        supabase.get_clan_members.return_value = [{**row, "attacktime": [0, None, None]}]
        await clan.ResyncSupabaseMembers()
        clan.OnMessageHandled.assert_awaited_once_with(clan.guild)

    async def test_dead_realtime_is_resubscribed_and_members_resynced(self) -> None:
        app = NextBotApp.__new__(NextBotApp)
        clan = Clan()
        clan.ResyncSupabaseMembers = AsyncMock()
        app._clans = {123: clan}
        dead_listen_task = MagicMock(done=MagicMock(return_value=True))
        old_client = MagicMock(realtime=MagicMock(_listen_task=dead_listen_task), remove_all_channels=AsyncMock())
        app._realtime_client = old_client
        app._realtime_channel = MagicMock(is_joined=True)
        app._subscribe_supabase_updates = AsyncMock()

        await app._ensure_realtime_subscription()

        old_client.remove_all_channels.assert_awaited_once()
        app._subscribe_supabase_updates.assert_awaited_once()
        clan.ResyncSupabaseMembers.assert_awaited_once()

    async def test_alive_realtime_is_left_as_is(self) -> None:
        app = NextBotApp.__new__(NextBotApp)
        app._clans = {}
        alive_listen_task = MagicMock(done=MagicMock(return_value=False))
        app._realtime_client = MagicMock(realtime=MagicMock(_listen_task=alive_listen_task))
        app._realtime_channel = MagicMock(is_joined=True)
        app._subscribe_supabase_updates = AsyncMock()

        await app._ensure_realtime_subscription()

        app._subscribe_supabase_updates.assert_not_awaited()

    def test_delete_realtime_payload_uses_old_record_clan_id(self) -> None:
        app = NextBotApp.__new__(NextBotApp)
        clan = Clan()
        app._clans = {123: clan}
        payload = {
            "data": {
                "record": None,
                "old_record": {"clanid": "123", "memberid": "456"},
            }
        }

        result = app._get_realtime_clan(payload)

        self.assertEqual(result, (clan, payload["data"]["old_record"], {}))

    def test_crossed_scheduled_time_detects_window(self) -> None:
        last_run = datetime.datetime(2026, 7, 24, 4, 59, 10, tzinfo=constants.JST)
        target = datetime.datetime(2026, 7, 24, 5, 0, tzinfo=constants.JST)
        now = datetime.datetime(2026, 7, 24, 5, 0, 20, tzinfo=constants.JST)

        self.assertTrue(constants.crossed_scheduled_time(last_run, target, now))
        self.assertFalse(constants.crossed_scheduled_time(now, target, now + datetime.timedelta(minutes=1)))
        self.assertFalse(
            constants.crossed_scheduled_time(
                datetime.datetime(2026, 7, 24, 5, 0, tzinfo=constants.JST),
                target,
                now,
            )
        )

    def _create_scheduled_app(
        self,
        attacktime: list[int | None] | None = None,
        start_date: str = "2026-07-25",
        end_date: str = "2026-07-30",
    ) -> tuple[NextBotApp, Clan, ClanMember, MagicMock]:
        clan, member, supabase = self.create_clan(attacktime)
        channel = MagicMock()
        channel.send = AsyncMock()
        clan.guild = MagicMock()
        clan.guild.name = "test guild"
        clan.FindChannel = MagicMock(return_value=channel)
        clan.OnMessageHandled = AsyncMock()
        app = NextBotApp.__new__(NextBotApp)
        app.supabase = supabase
        app.supabase.get_clanbattle_setting.return_value = {
            "startDate": start_date,
            "endDate": end_date,
        }
        app.clanbattle_setting = {"startDate": start_date, "endDate": end_date}
        app._clans = {123: clan}
        return app, clan, member, channel

    async def test_five_am_reloads_setting_and_resets_attacktime(self) -> None:
        app, clan, member, channel = self._create_scheduled_app([20, 0, None])
        app.supabase.get_clanbattle_setting.return_value = {
            "startDate": "2026-07-25",
            "endDate": "2026-07-30",
        }

        await app._on_minute_tick(
            datetime.datetime(2026, 7, 20, 4, 59, 30, tzinfo=constants.JST),
            datetime.datetime(2026, 7, 20, 5, 0, 10, tzinfo=constants.JST),
        )

        app.supabase.get_clanbattle_setting.assert_called_once_with()
        app.supabase.reset_clan_members_attacktime.assert_called_once_with(123)
        self.assertEqual(member.attacktime, [None, None, None])
        self.assertEqual(clan.clanbattle_setting["startDate"], "2026-07-25")
        channel.send.assert_not_awaited()

    async def test_clanbattle_eve_sends_notice_and_resets_bosslaps(self) -> None:
        app, clan, _member, channel = self._create_scheduled_app()
        clan.supabase_data = {"bosslaps": [3, 2, 1, 1, 1]}

        await app._on_minute_tick(
            datetime.datetime(2026, 7, 24, 4, 59, 30, tzinfo=constants.JST),
            datetime.datetime(2026, 7, 24, 5, 0, 10, tzinfo=constants.JST),
        )

        channel.send.assert_awaited_with(constants.CLANBATTLE_EVE_MESSAGE)
        app.supabase.update_clan_bosslaps.assert_called_with(123, [1, 1, 1, 1, 1])
        self.assertEqual(clan.supabase_data["bosslaps"], [1, 1, 1, 1, 1])

    async def test_clanbattle_start_sends_notice_and_resets_bosslaps(self) -> None:
        app, _clan, _member, channel = self._create_scheduled_app()

        await app._on_minute_tick(
            datetime.datetime(2026, 7, 25, 4, 59, 30, tzinfo=constants.JST),
            datetime.datetime(2026, 7, 25, 5, 0, 10, tzinfo=constants.JST),
        )

        channel.send.assert_awaited_with(constants.CLANBATTLE_START_MESSAGE)
        app.supabase.update_clan_bosslaps.assert_called_with(123, [1, 1, 1, 1, 1])

    async def test_clanbattle_last_day_sends_notice(self) -> None:
        app, _clan, _member, channel = self._create_scheduled_app()

        await app._on_minute_tick(
            datetime.datetime(2026, 7, 30, 4, 59, 30, tzinfo=constants.JST),
            datetime.datetime(2026, 7, 30, 5, 0, 10, tzinfo=constants.JST),
        )

        channel.send.assert_awaited_with(constants.CLANBATTLE_LAST_DAY_MESSAGE)
        app.supabase.update_clan_bosslaps.assert_not_called()

    async def test_clanbattle_end_sends_notice_at_next_midnight(self) -> None:
        app, _clan, _member, channel = self._create_scheduled_app()

        await app._on_minute_tick(
            datetime.datetime(2026, 7, 30, 23, 59, 30, tzinfo=constants.JST),
            datetime.datetime(2026, 7, 31, 0, 0, 10, tzinfo=constants.JST),
        )

        channel.send.assert_awaited_with(constants.CLANBATTLE_END_MESSAGE)


if __name__ == "__main__":
    unittest.main()
