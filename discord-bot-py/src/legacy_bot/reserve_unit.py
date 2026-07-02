from __future__ import annotations

from .shared import *
from .clan_member import ClanMember

class ReserveUnit:
    def __init__(self, boss: int, member: ClanMember, comment : Optional[str]):
        self.boss = boss
        self.member = member
        self.SetComment(comment)

    num3 = re.compile('[\d]{3,}')
    def SetComment(self, comment):
        self.comment = comment

        if self.comment is None:
            self.damage = 0
            return

        m = self.num3.search(comment)
        if m:
            self.damage = int(m.group())
        else:
            self.damage = 0

    def StatusName(self):
        name = self.member.DecoName('nO')
        if self.comment is not None and 0 < len(self.comment): 
            name += '[%s]' % self.comment
        return name

    @staticmethod
    def Deserialize(dic : Dict,  members : Dict[int, ClanMember]):
        if 'boss' not in dic: return None
        boss = dic['boss']

        if 'member' not in dic: return None
        mid = dic['member']
        if mid not in members: return None
        member = members[mid]

        if 'comment' not in dic: return None
        comment = dic['comment']

        return ReserveUnit(boss, member, comment)

    def Serialize(self):
        return {
            'boss' : self.boss,
            'comment' : self.comment,
            'member' : self.member.id,
        }


