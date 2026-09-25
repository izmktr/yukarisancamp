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

export type ClanAttackSortKey = {
  overattack: number | null | undefined;
  carrytime: number | null | undefined;
  damage: number | null | undefined;
};

type ClanAttackSortableMember = {
  overattack: number | null | undefined;
  damage: number | null | undefined;
  sortie: number;
  attacktime: Array<number | null>;
};

function toCarryTime(value: unknown): number {
  const numeric = Number(value);
  return value !== null && value !== undefined && Number.isFinite(numeric) ? numeric : Infinity;
}

// 持ち越し→通常、持ち越し時間の短い順、ダメージの大きい順
export function compareClanAttackMembers(left: ClanAttackSortKey, right: ClanAttackSortKey): number {
  const leftCarry = Number(left.overattack) === 1;
  const rightCarry = Number(right.overattack) === 1;
  if (leftCarry !== rightCarry) {
    return leftCarry ? -1 : 1;
  }
  if (leftCarry) {
    const leftTime = toCarryTime(left.carrytime);
    const rightTime = toCarryTime(right.carrytime);
    if (leftTime !== rightTime) {
      return leftTime < rightTime ? -1 : 1;
    }
  }
  return toDamage(right.damage) - toDamage(left.damage);
}

export function getClanAttackCarryTime(member: ClanAttackSortableMember): number | null {
  const value = Array.isArray(member.attacktime) ? member.attacktime[Number(member.sortie) - 1] : null;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function sortClanAttackMembers<T extends ClanAttackSortableMember>(members: T[]): T[] {
  return members
    .map((member) => ({ member, key: { ...member, carrytime: getClanAttackCarryTime(member) } }))
    .sort((left, right) => compareClanAttackMembers(left.key, right.key))
    .map((item) => item.member);
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
