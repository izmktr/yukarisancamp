from __future__ import annotations

import types
import unittest
from unittest.mock import AsyncMock, MagicMock

from src.nextbot.clan import Clan
from src.nextbot.clan_member import ClanMember


class AttackTests(unittest.IsolatedAsyncioTestCase):
    def create_clan(self, attacktime: list[int | None] | None = None) -> tuple[Clan, ClanMember, MagicMock]:
        supabase = MagicMock()
        clan = Clan(supabase=supabase, clan_id=123)
        clan.supabase_data = {"bosslaps": [1, 1, 1, 1, 1]}
        member = ClanMember(456)
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

    async def test_one_digit_attack_uses_the_number_as_boss(self) -> None:
        clan, member, supabase = self.create_clan()
        message = self.create_message()

        result = await clan.Attack(message, self.create_discord_member(), "5")

        self.assertTrue(result)
        self.assertEqual((member.boss, member.sortie), (5, 1))
        supabase.update_discord_clan_member_attack.assert_called_once_with(
            123, 456, "new name", "<@456>", 5, 1, 1, 0, clan.CurrentBaseDate()
        )
        clan.AddReaction.assert_awaited_once_with(message, False)

    async def test_two_digit_attack_uses_carry_over_sortie(self) -> None:
        clan, member, supabase = self.create_clan([None, 50, None])
        message = self.create_message()

        result = await clan.Attack(message, self.create_discord_member(), "52")

        self.assertTrue(result)
        self.assertEqual((member.boss, member.sortie), (5, 2))
        supabase.update_discord_clan_member_attack.assert_called_once_with(
            123, 456, "new name", "<@456>", 5, 1, 2, 1, clan.CurrentBaseDate()
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
        clan.RemoveReaction = AsyncMock()
        reaction = clan.CreateAttackReaction(member, message, 5, 1, 0)
        payload = types.SimpleNamespace(
            message_id=message.id,
            emoji=types.SimpleNamespace(name=clan.emojis[1]),
        )

        result = await reaction.addreaction(member, payload)

        self.assertTrue(result)
        supabase.finish_clan_member_attack.assert_called_once_with(
            456, "old name", "<@456>", 100, "defeat", 20
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
        clan.RemoveReaction = AsyncMock()
        reaction = clan.CreateAttackReaction(member, message, 5, 2, 50)
        payload = types.SimpleNamespace(
            message_id=message.id,
            emoji=types.SimpleNamespace(name=clan.numbermarks[0]),
        )

        result = await reaction.addreaction(member, payload)

        self.assertTrue(result)
        supabase.finish_clan_member_attack.assert_called_once_with(
            456, "old name", "<@456>", 100, "defeat", 0
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
        supabase.revert_clan_member_attack.assert_called_once_with(456, 79)
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
            123, 456, "old name", "<@456>", 5, 1, 2, 1, clan.CurrentBaseDate()
        )
        clan.AddReaction.assert_awaited_once_with(message, True)


if __name__ == "__main__":
    unittest.main()
