import { geocodeAddress, KakaoFatalError } from '../geo/kakao.js';
import { geocodeQueries, loadGeoCache, openGeoCacheWriter } from './geo.js';
import { readTrades } from './raw.js';

export interface GeocodeOptions {
  apiKey: string;
  /** 못 찾았던 단지 다시 시도 */
  retryMiss?: boolean;
  concurrency?: number;
  log?: (msg: string) => void;
}

/**
 * data/raw의 단지 중 캐시에 없는 것만 카카오 주소 검색 → data/geo/complexes.ndjson
 * 거래(수십만 건)가 아니라 단지(수천 개) 단위. 매일 갱신 때는 새로 생긴 단지만 호출됨
 */
export async function geocodeComplexes(opts: GeocodeOptions) {
  const log = opts.log ?? console.log;
  const cache = await loadGeoCache();
  const todo = new Map<string, { aptName: string; queries: ReturnType<typeof geocodeQueries> }>();
  for await (const { doc, raw } of readTrades()) {
    if (todo.has(doc.complexId)) continue;
    const cached = cache.get(doc.complexId);
    if (cached && !('miss' in cached && opts.retryMiss)) continue;
    todo.set(doc.complexId, { aptName: doc.aptName, queries: geocodeQueries(doc, raw) });
  }
  log(`캐시 ${cache.size}개, 지오코딩할 단지 ${todo.size}개`);

  const out = await openGeoCacheWriter();
  const jobs = [...todo];
  const result = { found: 0, missed: 0, aborted: null as Error | null };

  const worker = async () => {
    while (jobs.length > 0 && !result.aborted) {
      const [complexId, { aptName, queries }] = jobs.shift()!;
      try {
        let hit = false;
        for (const { by, query } of queries) {
          const loc = await geocodeAddress(opts.apiKey, query);
          if (loc) {
            await out.append({ complexId, ...loc, by, query });
            hit = true;
            break;
          }
        }
        if (hit) {
          result.found++;
        } else {
          result.missed++;
          await out.append({ complexId, miss: true, queries: queries.map((q) => q.query) });
          log(`  못 찾음: ${aptName} (${queries.map((q) => q.query).join(' / ') || '주소 없음'})`);
        }
        if ((result.found + result.missed) % 200 === 0) log(`진행 ${result.found + result.missed}/${todo.size}`);
      } catch (err) {
        if (err instanceof KakaoFatalError) result.aborted = err;
        else log(`  실패(다음 실행 때 재시도): ${aptName}: ${(err as Error).message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency ?? 4 }, worker));
  await out.close();
  return result;
}
