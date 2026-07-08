
# bot 仕様書

## 処理概要
特定のチャンネルに書き込まれたメッセージ、または自分宛てにメンションを飛ばしたメッセージが対象になる

特定のチャンネルは、以下の名前の名前を持つチャンネルである
INPUT_CHANNEL = "凸報告"


メッセージは「先頭に特定の文字列を含む場合」後述する形式で関数を呼び出す
この文字列は、長い文字列を優先して処理する
(「at」と「attack」が処理対象の場合、attack側の関数を呼び出し、atは呼び出さない)


これは、第一の[]のどれかの文字列があった場合、self.Attackを呼び出す

class Clan:
funcList = [
    (['a', '凸', 'あ'], self.Attack),
    (['c', '持'], self.ContinuasAttack),
]


後者の関数は以下の形式である

async def Attack(self, message, member : discord.Member, opt : string) -> bool:
    return True

