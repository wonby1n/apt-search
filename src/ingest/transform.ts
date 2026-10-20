import { createHash } from 'node:crypto';
import type { RawTrade } from './molit.js';
import { findRegion } from './regions.js';

/** ES에 들어가는 문서 형태. 매핑(src/es/mapping.ts)과 1:1 */
export interface TradeDoc {
  aptName: string;
  aptSeq: string | null;
  aptDong: string | null;
  sido: string | null;
  sggCd: string;
  sggName: string | null;
  umdName: string | null;
  jibun: string | null;
  roadName: string | null;
  address: string;
  buildYear: number | null;
  dealDate: string; // yyyy-MM-dd
  dealAmount: number; // 만원
  area: number; // 전용면적 ㎡
  pricePerPyeong: number; // 전용면적 기준 평당가 (만원)
  floor: number | null;
  dealingType: string | null;
  buyerType: string | null;
  sellerType: string | null;
  canceled: boolean;
  cancelDate: string | null;
}

export const SQM_PER_PYEONG = 3.305785;

const clean = (v: string | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

const toInt = (v: string | undefined): number | null => {
  const t = clean(v)?.replace(/,/g, '');
  if (t == null) return null;
  const n = Number.parseInt(t, 10);
  return Number.isFinite(n) ? n : null;
};

const toFloat = (v: string | undefined): number | null => {
  const t = clean(v);
  if (t == null) return null;
  const n = Number.parseFloat(t);
  return Number.isFinite(n) ? n : null;
};

const pad2 = (n: number) => String(n).padStart(2, '0');

/** "24.03.15" → "2024-03-15" (해제사유발생일 포맷) */
export function parseShortDate(v: string | undefined): string | null {
  const m = clean(v)?.match(/^(\d{2})\.(\d{1,2})\.(\d{1,2})$/);
  if (!m) return null;
  return `20${m[1]}-${pad2(Number(m[2]))}-${pad2(Number(m[3]))}`;
}

/**
 * 동일 거래를 다시 수집해도 같은 _id가 나오도록 결정적 해시를 만든다.
 * → 재수집/재색인 시 중복 없이 덮어쓰기(멱등)
 */
export function tradeId(r: RawTrade): string {
  const key = [
    r.sggCd, r.umdNm, r.jibun, r.aptNm, r.aptDong,
    r.dealYear, r.dealMonth, r.dealDay, r.floor, r.excluUseAr, r.dealAmount,
  ].map((v) => v?.trim() ?? '').join('|');
  return createHash('sha1').update(key).digest('hex');
}

export type TransformResult =
  | { ok: true; id: string; doc: TradeDoc }
  | { ok: false; reason: string; raw: RawTrade };

export function transformTrade(r: RawTrade, lawdCdHint?: string): TransformResult {
  const aptName = clean(r.aptNm);
  const amount = toInt(r.dealAmount);
  const area = toFloat(r.excluUseAr);
  const y = toInt(r.dealYear);
  const mo = toInt(r.dealMonth);
  const d = toInt(r.dealDay);
  const sggCd = clean(r.sggCd) ?? lawdCdHint ?? null;

  if (!aptName) return { ok: false, reason: 'aptNm 없음', raw: r };
  if (amount == null || amount <= 0) return { ok: false, reason: 'dealAmount 파싱 실패', raw: r };
  if (area == null || area <= 0) return { ok: false, reason: 'excluUseAr 파싱 실패', raw: r };
  if (y == null || mo == null || d == null) return { ok: false, reason: '계약일 파싱 실패', raw: r };
  if (!sggCd) return { ok: false, reason: 'sggCd 없음', raw: r };

  const region = findRegion(sggCd);
  const umdName = clean(r.umdNm);
  const jibun = clean(r.jibun);

  const doc: TradeDoc = {
    aptName,
    aptSeq: clean(r.aptSeq),
    aptDong: clean(r.aptDong),
    sido: region?.sido ?? null,
    sggCd,
    sggName: region?.sgg ?? null,
    umdName,
    jibun,
    roadName: clean(r.roadNm),
    address: [region?.sido, region?.sgg, umdName, jibun, aptName].filter(Boolean).join(' '),
    buildYear: toInt(r.buildYear),
    dealDate: `${y}-${pad2(mo)}-${pad2(d)}`,
    dealAmount: amount,
    area,
    pricePerPyeong: Math.round(amount / (area / SQM_PER_PYEONG)),
    floor: toInt(r.floor),
    dealingType: clean(r.dealingGbn),
    buyerType: clean(r.buyerGbn),
    sellerType: clean(r.slerGbn),
    canceled: clean(r.cdealType) === 'O',
    cancelDate: parseShortDate(r.cdealDay),
  };

  return { ok: true, id: tradeId(r), doc };
}
