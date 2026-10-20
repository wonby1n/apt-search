import { join } from 'node:path';
import type { RawTrade } from './molit.js';
import { openAppendWriter, readNdjson } from './ndjson.js';
import type { TradeDoc } from './transform.js';

/** 단지별 지오코딩 결과 캐시. 한 줄에 한 단지, 이어쓰기라 중간에 끊겨도 받은 만큼 남음 */
export const GEO_CACHE_FILE = join(process.cwd(), 'data', 'geo', 'complexes.ndjson');

export type GeoEntry =
  | { complexId: string; lat: number; lon: number; by: 'jibun' | 'road'; query: string }
  | { complexId: string; miss: true; queries: string[] };

export async function loadGeoCache(file = GEO_CACHE_FILE): Promise<Map<string, GeoEntry>> {
  const map = new Map<string, GeoEntry>();
  // 같은 단지가 여러 줄이면(--retry-miss) 마지막 결과. 반쯤 쓰인 줄의 단지는 다시 지오코딩됨
  for await (const e of readNdjson<GeoEntry>(file)) map.set(e.complexId, e);
  return map;
}

export const openGeoCacheWriter = (file = GEO_CACHE_FILE) => openAppendWriter<GeoEntry>(file);

const stripZeros = (v: string | undefined) => String(Number.parseInt(v ?? '', 10) || '');

/**
 * 단지 하나를 지오코딩할 주소 후보 (앞에서부터 시도)
 * - 지번: "서울특별시 서초구 반포동 20-43" — 법정동 + 지번이라 단지를 거의 정확히 가리킴
 * - 도로명: "서울특별시 서초구 신반포로 270" — 지번이 없거나 못 찾을 때
 */
export function geocodeQueries(doc: TradeDoc, raw: RawTrade): Array<{ by: 'jibun' | 'road'; query: string }> {
  const base = [doc.sido, doc.sggName].filter(Boolean).join(' ');
  const out: Array<{ by: 'jibun' | 'road'; query: string }> = [];
  if (doc.umdName && doc.jibun) out.push({ by: 'jibun', query: `${base} ${doc.umdName} ${doc.jibun}` });

  const bon = stripZeros(raw.roadNmBonbun);
  const bu = stripZeros(raw.roadNmBubun);
  if (doc.roadName && bon) out.push({ by: 'road', query: `${base} ${doc.roadName} ${bon}${bu ? `-${bu}` : ''}` });
  return out;
}
