import type { Client } from '@elastic/elasticsearch';
import { createVersionedIndex, pruneOldIndices, swapAlias } from '../es/indices.js';
import { loadFirstSeen } from './first-seen.js';
import { loadGeoCache } from './geo.js';
import { newReadStats, readTrades } from './raw.js';
import type { TradeDoc } from './transform.js';

export interface ReindexOptions {
  /** alias 교체 후 남겨 둘 이전 인덱스 수 (롤백용). 그보다 오래된 버전 인덱스는 삭제 */
  keepPrevious?: number;
  log?: (msg: string) => void;
}

/** data/raw → 새 버전 인덱스에 bulk 색인(좌표·처음 본 날짜 포함) → alias 교체 (무중단 재색인) */
export async function reindex(es: Client, alias: string, opts: ReindexOptions = {}) {
  const log = opts.log ?? console.log;
  const index = await createVersionedIndex(es, alias);
  log(`새 인덱스 생성: ${index}`);

  // 둘 다 없으면 location·firstSeenDate 없이 색인
  const geo = await loadGeoCache();
  const firstSeen = await loadFirstSeen();
  let located = 0;

  const stats = newReadStats();
  const started = Date.now();
  async function* docs() {
    for await (const { id, doc } of readTrades(stats)) {
      const hit = geo.get(doc.complexId);
      if (hit && 'lat' in hit) {
        doc.location = { lat: hit.lat, lon: hit.lon };
        located++;
      }
      doc.firstSeenDate = firstSeen.get(id) ?? null;
      yield { id, doc };
    }
  }

  const result = await es.helpers.bulk<{ id: string; doc: TradeDoc }>({
    datasource: docs(),
    flushBytes: 5_000_000,
    concurrency: 4,
    // [action, payload] 튜플을 반환하면 payload가 문서 본문이 됨 (id는 본문에서 제외)
    onDocument: (d) => [{ index: { _index: index, _id: d.id } }, d.doc],
    onDrop: (dropped) => log(`색인 실패: ${dropped.error?.reason ?? JSON.stringify(dropped.error)}`),
  });

  const sec = ((Date.now() - started) / 1000).toFixed(1);
  log(
    `원본 ${stats.read.toLocaleString()}건 → 색인 ${result.successful.toLocaleString()}건, ` +
      `실패 ${result.failed}건, 변환 제외 ${stats.skipped}건 (${sec}s)`,
  );
  for (const [reason, n] of stats.skipReasons) log(`  - 제외 사유 "${reason}": ${n}건`);
  log(`좌표 있는 거래 ${located.toLocaleString()}건 (지오코딩 캐시 단지 ${geo.size.toLocaleString()}개)`);

  if (result.failed > 0 && result.successful === 0) {
    await es.indices.delete({ index });
    throw new Error('색인 성공 건이 없어 alias 교체를 중단합니다');
  }

  const old = await swapAlias(es, alias, index);
  log(`alias "${alias}" → ${index}` + (old.length ? ` (이전: ${old.join(', ')})` : ''));
  if (opts.keepPrevious != null) {
    const deleted = await pruneOldIndices(es, alias, index, opts.keepPrevious);
    if (deleted.length) log(`오래된 인덱스 삭제: ${deleted.join(', ')}`);
  }
  return { index, indexed: result.successful, failed: result.failed };
}
