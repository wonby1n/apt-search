import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseTradeXml } from '../src/ingest/molit.js';
import { monthRange } from '../src/ingest/months.js';
import { resolveRegions } from '../src/ingest/regions.js';
import { parseShortDate, tradeId, transformTrade } from '../src/ingest/transform.js';

const [raemian, eunma] = parseTradeXml(
  readFileSync(new URL('./fixtures/trade-page.xml', import.meta.url), 'utf8'),
).items;

describe('transformTrade', () => {
  it('금액 쉼표·공백, 날짜, 평당가를 정규화한다', () => {
    const r = transformTrade(raemian!);
    if (!r.ok) throw new Error(r.reason);
    expect(r.doc).toMatchObject({
      aptName: '래미안퍼스티지',
      sido: '서울특별시',
      sggName: '서초구',
      umdName: '반포동',
      dealDate: '2024-03-07',
      dealAmount: 385000,
      area: 84.93,
      floor: 12,
      aptDong: null, // 공백 → null
      canceled: false,
      cancelDate: null,
      address: '서울특별시 서초구 반포동 20-43 래미안퍼스티지',
    });
    // 385,000만원 / (84.93㎡ / 3.305785) = 14,985.6 → 14,986만원/평
    expect(r.doc.pricePerPyeong).toBe(14986);
  });

  it('해제 거래와 지하층을 처리한다', () => {
    const r = transformTrade(eunma!);
    if (!r.ok) throw new Error(r.reason);
    expect(r.doc.canceled).toBe(true);
    expect(r.doc.cancelDate).toBe('2024-04-02');
    expect(r.doc.floor).toBe(-1);
    expect(r.doc.dealingType).toBe('직거래');
  });

  it('필수값이 없으면 사유와 함께 제외한다', () => {
    const r = transformTrade({ ...raemian!, dealAmount: ' ' });
    expect(r).toMatchObject({ ok: false, reason: 'dealAmount 파싱 실패' });
  });

  it('같은 거래는 공백 차이가 있어도 같은 id (멱등 색인)', () => {
    expect(tradeId(raemian!)).toBe(tradeId({ ...raemian!, dealAmount: '385,000' }));
    expect(tradeId(raemian!)).not.toBe(tradeId(eunma!));
  });
});

describe('utils', () => {
  it('parseShortDate', () => {
    expect(parseShortDate('24.4.2')).toBe('2024-04-02');
    expect(parseShortDate(' ')).toBeNull();
  });

  it('monthRange는 연도를 넘어간다', () => {
    expect(monthRange('202311', '202402')).toEqual(['202311', '202312', '202401', '202402']);
  });

  it('resolveRegions', () => {
    expect(resolveRegions('seoul')).toHaveLength(25);
    expect(resolveRegions('busan')).toHaveLength(16);
    expect(resolveRegions('11680,seoul')).toHaveLength(25); // 중복 제거
    expect(() => resolveRegions('99999')).toThrow();
  });
});
