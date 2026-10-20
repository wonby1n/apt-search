import { describe, expect, it } from 'vitest';
import { localDate, newIds } from '../src/ingest/first-seen.js';
import { recentMonths } from '../src/ingest/months.js';
import { nextRunAt } from '../src/ingest/refresh.js';

describe('매일 갱신', () => {
  it('최근 2개월 = 지난달 + 이번 달 (연도 넘어감 포함)', () => {
    expect(recentMonths(2, new Date(2026, 9, 20))).toEqual(['202609', '202610']);
    expect(recentMonths(2, new Date(2027, 0, 1))).toEqual(['202612', '202701']);
  });

  it('직전 파일에 없던 거래만 신규 (중복 제거)', () => {
    expect(newIds(['a', 'b'], ['b', 'c', 'c', 'd'])).toEqual(['c', 'd']);
    expect(newIds([], ['a'])).toEqual(['a']); // 처음 받는 달은 전부 신규
  });

  it('다음 실행 시각: 오늘 그 시각이 지났으면 내일', () => {
    const now = new Date(2026, 9, 20, 15, 0);
    expect(nextRunAt('03:00', now)).toEqual(new Date(2026, 9, 21, 3, 0));
    expect(nextRunAt('18:30', now)).toEqual(new Date(2026, 9, 20, 18, 30));
  });

  it('처음 본 날짜는 로컬 날짜', () => {
    expect(localDate(new Date(2026, 9, 21, 0, 30))).toBe('2026-10-21');
  });
});
