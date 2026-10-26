type History = {
  id: number; clanid?: string; memberid?: string; day?: string | number | null;
  sortie: number; sortiecount?: number; boss: number; attacklap: number | null; overtime: number;
};

export function selectMainAttacks(histories: History[]): History[] {
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
    return selected && selected.attacklap !== null && selected.attacklap >= 23 ? [selected] : [];
  });
}

export function buildClanPlan(histories: History[], members: { memberid: string; name: string }[], laps: number[], today: string, start: string, end: string) {
  const previous = new Date(`${today}T00:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  const yesterday = previous.toISOString().slice(0, 10);
  const inPeriod = !!start && !!end && today >= start && today <= end;
  const attacks = selectMainAttacks(histories.filter(r => String(r.day) >= start && String(r.day) <= end && String(r.day) <= today));
  const count = (day: string, boss: number, member?: string) => attacks.filter(r => r.day === day && r.boss === boss && (member === undefined || r.memberid === member)).length;
  const ids = [...new Set([...members.map(m => m.memberid), ...attacks.map(r => r.memberid).filter((id): id is string => !!id)])];
  const movement = ids.map(id => {
    const from = Array.from({ length: 5 }, (_, i) => Math.max(0, count(yesterday, i + 1, id) - count(today, i + 1, id)));
    const to = Array.from({ length: 5 }, (_, i) => Math.max(0, count(today, i + 1, id) - count(yesterday, i + 1, id)));
    return { name: members.find(m => m.memberid === id)?.name || id, from, to };
  }).filter(m => m.to.some(n => n > 0));
  const bosses = Array.from({ length: 5 }, (_, i) => {
    const boss = i + 1;
    const lap = laps[i];
    const current = attacks.filter(r => r.boss === boss && r.attacklap === lap).length;
    const completed = attacks.filter(r => r.boss === boss && r.attacklap! >= 23 && r.attacklap! < lap).length;
    const average = lap > 23 && completed > 0 ? completed / (lap - 23) : null;
    const planned = count(yesterday, boss);
    const done = count(today, boss);
    const remaining = planned - done;
    let landing: { lap: number; attacks: number } | null = null;
    if (inPeriod && today > start && average && remaining > 0) {
      const total = current + remaining;
      const advance = Math.floor(total / average);
      landing = { lap: lap + advance, attacks: Math.ceil(Math.max(0, total - advance * average - 1e-9)) };
    }
    return { boss, lap, current, average, planned, done, remaining, landing };
  });
  return { bosses, movement: inPeriod && today > start ? movement : [], inPeriod, hasPrevious: inPeriod && today > start };
}
