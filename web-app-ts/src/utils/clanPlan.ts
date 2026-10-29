type History = {
  id: number; clanid?: string; memberid?: string; day?: string | number | null;
  sortie: number; sortiecount?: number; boss: number; attacklap: number | null; overtime: number;
  damage?: number | null;
};

function selectMainAttacksWithoutLapFilter(histories: History[]): History[] {
  const groups = new Map<string, History[]>();
  for (const row of histories) {
    const key = JSON.stringify([row.clanid, row.day, row.memberid, row.sortie]);
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  return [...groups.values()].flatMap((rows) => {
    const sorted = [...rows].sort((a, b) => a.id - b.id);
    const selected = sorted.find(r => r.sortiecount === 2)
      || sorted.find(r => r.sortiecount === 1 && r.overtime > 0 && r.overtime <= 50)
      || sorted.find(r => r.sortiecount === 1 && r.overtime === 0);
    return selected ? [selected] : [];
  });
}

export function selectMainAttacks(histories: History[]): History[] {
  return selectMainAttacksWithoutLapFilter(histories).filter(r => r.attacklap !== null && r.attacklap >= 23);
}

export function buildClanPlan(histories: History[], members: { memberid: string; name: string }[], laps: number[], today: string, start: string, end: string) {
  const previous = new Date(`${today}T00:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  const yesterday = previous.toISOString().slice(0, 10);
  const inPeriod = !!start && !!end && today >= start && today <= end;
  const allAttacks = selectMainAttacksWithoutLapFilter(histories.filter(r => String(r.day) >= start && String(r.day) <= end && String(r.day) <= today));
  const attacks = allAttacks.filter(r => r.attacklap !== null && r.attacklap >= 23);
  const previousAttacks = allAttacks.filter(r => r.day === yesterday).length;
  const completedAttacks = allAttacks.filter(r => r.day === today).length;
  const count = (day: string, boss: number, member?: string) => attacks.filter(r => r.day === day && r.boss === boss && (member === undefined || r.memberid === member)).length;
  const ids = [...new Set([...members.map(m => m.memberid), ...attacks.map(r => r.memberid).filter((id): id is string => !!id)])];
  const memberPlans = ids.map(id => ({
    memberid: id,
    name: members.find(m => m.memberid === id)?.name || id,
    planned: Array.from({ length: 5 }, (_, i) => count(yesterday, i + 1, id)),
    done: Array.from({ length: 5 }, (_, i) => count(today, i + 1, id)),
    maxDamage: Array.from({ length: 5 }, (_, i) => attacks.reduce<number | null>((max, attack) => {
      if (attack.memberid !== id || attack.boss !== i + 1 || attack.damage == null) return max;
      return max === null ? attack.damage : Math.max(max, attack.damage);
    }, null))
  }));
  const predictableMembers = memberPlans.filter(m => !m.done.some((done, i) => done > m.planned[i]));
  const bosses = Array.from({ length: 5 }, (_, i) => {
    const boss = i + 1;
    const lap = laps[i];
    const current = attacks.filter(r => r.boss === boss && r.attacklap === lap).length;
    const completed = attacks.filter(r => r.boss === boss && r.attacklap! >= 23 && r.attacklap! < lap).length;
    const average = lap > 23 && completed > 0 ? completed / (lap - 23) : null;
    const planned = count(yesterday, boss);
    const done = count(today, boss);
    const remaining = predictableMembers.reduce((total, m) => total + Math.max(0, m.planned[i] - m.done[i]), 0);
    let landing: { lap: number; attacks: number } | null = null;
    if (inPeriod && today > start && average && remaining > 0) {
      const total = current + remaining;
      const advance = Math.floor(total / average);
      landing = { lap: lap + advance, attacks: Math.ceil(Math.max(0, total - advance * average - 1e-9)) };
    }
    return { boss, lap, current, average, planned, done, remaining, landing };
  });
  return { bosses, memberPlans, previousAttacks, completedAttacks, inPeriod, hasPrevious: inPeriod && today > start };
}
