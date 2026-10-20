/** "202401" ~ "202403" → ["202401","202402","202403"] */
export function monthRange(from: string, to: string): string[] {
  const parse = (s: string) => {
    if (!/^\d{6}$/.test(s)) throw new Error(`YYYYMM 형식이 아님: ${s}`);
    return Number(s.slice(0, 4)) * 12 + Number(s.slice(4)) - 1;
  };
  const a = parse(from);
  const b = parse(to);
  if (a > b) throw new Error(`from(${from})이 to(${to})보다 뒤`);
  const out: string[] = [];
  for (let i = a; i <= b; i++) {
    out.push(`${Math.floor(i / 12)}${String((i % 12) + 1).padStart(2, '0')}`);
  }
  return out;
}

export function currentYmd(now = new Date()): string {
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** 최근 n개월 (이번 달 포함). 2 → ["202609", "202610"] */
export function recentMonths(n: number, now = new Date()): string[] {
  const to = currentYmd(now);
  const back = new Date(now.getFullYear(), now.getMonth() - (n - 1), 1);
  return monthRange(currentYmd(back), to);
}
