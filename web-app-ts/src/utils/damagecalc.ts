const MAX_TIME = 90;
const BONUS_TIME = 20;

function remainTime(damage: number, remainhp: number): number {
    if (damage <= 0) return 0;

    const d = MAX_TIME  - Math.floor(MAX_TIME * remainhp / damage) + BONUS_TIME;
    if (MAX_TIME < d) return MAX_TIME;
    return d;
}

// 90秒になるために必要なダメージ
function requireDamage(remainhp: number): number {
    // damage = MAX_TIME * remainhp / BONUS_TIME;

    if (remainhp <= 0) return 0;
    return Math.ceil(MAX_TIME * remainhp / (BONUS_TIME + 1));
}
