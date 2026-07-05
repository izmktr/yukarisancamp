"""Legacy reserve unit model for clan battle bot."""

from __future__ import annotations

import re
from typing import Any, Optional

from .clan_member import ClanMember


class ReserveUnit:
    num3 = re.compile(r"\d{3,}")

    """A reserved attack entry for a specific boss and member."""

    def __init__(self, boss: int, member: ClanMember, comment : Optional[str]):
        self.boss = boss
        self.member = member
        self.SetComment(comment)


    def SetComment(self, comment : Optional[str]):  # pylint: disable=invalid-name
        """Set comment and parse estimated damage from 3+ consecutive digits."""
        self.comment = comment

        if self.comment is None:
            self.damage = 0
            return

        m = self.num3.search(self.comment)
        if m:
            self.damage = int(m.group())
        else:
            self.damage = 0

    def StatusName(self):  # pylint: disable=invalid-name
        """Return decorated member name with comment suffix."""
        name = self.member.DecoName('nO')
        if self.comment is not None and 0 < len(self.comment):
            name += f'[{self.comment}]'
        return name

    @staticmethod
    def Deserialize(dic : dict[str, Any],  members : dict[int, ClanMember]):  # pylint: disable=invalid-name
        """Build a ReserveUnit from serialized dict data."""
        if 'boss' not in dic:
            return None
        boss = dic['boss']
        if not isinstance(boss, int):
            return None

        if 'member' not in dic:
            return None
        mid = dic['member']
        if not isinstance(mid, int):
            return None
        if mid not in members:
            return None
        member = members[mid]

        if 'comment' not in dic:
            return None
        comment = dic['comment']
        if comment is not None and not isinstance(comment, str):
            return None

        return ReserveUnit(boss, member, comment)

    def Serialize(self) -> dict[str, int | str | None]:  # pylint: disable=invalid-name
        """Serialize the reserve entry to a dict."""
        return {
            'boss' : self.boss,
            'comment' : self.comment,
            'member' : self.member.id,
        }



