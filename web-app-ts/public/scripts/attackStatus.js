(function (root) {
    const MAX_TIME = 90;
    const BONUS_TIME = 20;

    function remainTime(damage, remainhp) {
        if (damage <= 0) {
            return 0;
        }

        const leftover = MAX_TIME - Math.floor(MAX_TIME * remainhp / damage) + BONUS_TIME;
        if (MAX_TIME < leftover) {
            return MAX_TIME;
        }
        return leftover;
    }

    function toDamage(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric <= 0) {
            return 0;
        }
        return Math.trunc(numeric);
    }

    function buildClanAttackMemberStatus(member, attackingMembers, bossHp) {
        if (!Number.isFinite(bossHp) || bossHp <= 0) {
            return '';
        }

        const ownDamage = toDamage(member.damage);
        if (ownDamage <= 0) {
            return '';
        }

        const others = (Array.isArray(attackingMembers) ? attackingMembers : [])
            .filter((item) => String(item.memberid) !== String(member.memberid));
        const othersTotal = others.reduce((sum, item) => sum + toDamage(item.damage), 0);

        if (ownDamage >= bossHp) {
            if (Number(member.overattack) === 1) {
                return '[持越]';
            }
            return `→${remainTime(ownDamage, bossHp)}秒`;
        }

        if (ownDamage + othersTotal > bossHp) {
            const remainHp = Math.max(0, bossHp - ownDamage);
            const topOthers = others
                .map((item) => ({
                    name: (item && typeof item.name === 'string' && item.name.trim() ? item.name.trim() : 'Unknown'),
                    damage: toDamage(item && item.damage)
                }))
                .filter((item) => item.damage > 0 && item.damage >= remainHp)
                .sort((left, right) => right.damage - left.damage || left.name.localeCompare(right.name, 'ja'))
                .slice(0, 3);

            if (topOthers.length === 0) {
                return '';
            }

            return topOthers
                .map((item) => `${item.name}→${remainTime(item.damage, remainHp)}秒`)
                .join('、');
        }

        return '';
    }

    root.ClanAttackStatus = {
        remainTime,
        buildClanAttackMemberStatus
    };
})(window);
