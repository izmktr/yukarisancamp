from __future__ import annotations

from .clan_member import ClanMember

class DamageControlMember:

    def __init__(self, member : ClanMember, damage : int, message : str = '', mark = 0) -> None:
        self.member : ClanMember = member
        self.damage = damage
        self.status = 0
        self.message = message
        self.mark = mark


