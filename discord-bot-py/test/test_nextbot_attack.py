from __future__ import annotations

import datetime
import json
import types
import unittest
from typing import Any, cast
from unittest.mock import AsyncMock, MagicMock, patch

import discord

from src.nextbot import constants
from src.nextbot.clan import Clan
from src.nextbot.clan_member import ClanMember
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
        clan.RemoveReaction = AsyncMock()
        reaction = clan.CreateAttackReaction(member, message, 5, 1, 0)
        payload = types.SimpleNamespace(
            message_id=message.id,
            emoji=types.SimpleNamespace(name=clan.emojis[1]),
        )

        result = await reaction.addreaction(member, payload)

        self.assertTrue(result)
        supabase.finish_clan_member_attack.assert_called_once_with(
            "456", "old name", "<@456>", 100, "defeat", 20
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
            "456", "old name", "<@456>", 100, "defeat", 0
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


if __name__ == "__main__":
    unittest.main()
