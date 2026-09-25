import { remainTime } from './damagecalc';

export type ClanAttackStatusMember = {
  memberid: string;
  name: string;
  damage: number | null | undefined;
  overattack: number | null | undefined;
};

function toDamage(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }
  return Math.trunc(numeric);
}

export function buildClanAttackMemberStatus(
  member: ClanAttackStatusMember,
  attackingMembers: ClanAttackStatusMember[],
  bossHp: number
): string {
  if (!Number.isFinite(bossHp) || bossHp <= 0) {
    return '';
  }

  const ownDamage = toDamage(member.damage);
  if (ownDamage <= 0) {
    return '';
  }

  const others = attackingMembers.filter((item) => String(item.memberid) !== String(member.memberid));
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
        name: (typeof item.name === 'string' && item.name.trim() ? item.name.trim() : 'Unknown'),
        damage: toDamage(item.damage)
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
