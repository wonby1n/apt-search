import type { Client } from '@elastic/elasticsearch';
import { indexMappings, indexSettings } from './mapping.js';

/** apt-trades → apt-trades-20261020-135500 */
export function versionedIndexName(alias: string, now = new Date()): string {
  const ts = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return `${alias}-${ts.slice(0, 8)}-${ts.slice(8)}`;
}

export async function createVersionedIndex(es: Client, alias: string): Promise<string> {
  const index = versionedIndexName(alias);
  await es.indices.create({
    index,
    settings: {
      ...indexSettings,
      // 대량 색인 중엔 refresh를 꺼서 세그먼트 생성 비용을 줄임 → 끝나고 복구
      refresh_interval: '-1',
    },
    mappings: indexMappings,
  });
  return index;
}

export async function getAliasTargets(es: Client, alias: string): Promise<string[]> {
  const exists = await es.indices.existsAlias({ name: alias });
  if (!exists) return [];
  const res = await es.indices.getAlias({ name: alias });
  return Object.keys(res);
}

/**
 * 새 인덱스 색인이 끝나면 alias를 원자적으로 교체 → 검색 API는 중단 없이 새 인덱스를 봄
 */
export async function swapAlias(
  es: Client,
  alias: string,
  newIndex: string,
  opts: { deleteOld?: boolean } = {},
): Promise<string[]> {
  await es.indices.putSettings({ index: newIndex, settings: { refresh_interval: '1s' } });
  await es.indices.refresh({ index: newIndex });

  const oldIndices = await getAliasTargets(es, alias);
  await es.indices.updateAliases({
    actions: [
      ...oldIndices.map((index) => ({ remove: { index, alias } })),
      { add: { index: newIndex, alias, is_write_index: true } },
    ],
  });

  if (opts.deleteOld && oldIndices.length > 0) {
    await es.indices.delete({ index: oldIndices });
  }
  return oldIndices;
}

/**
 * 버전 인덱스(alias-YYYYMMDD-hhmmss) 중 current와 그 직전 keep개만 남기고 삭제
 * 매일 갱신하면 하루 한 개씩 쌓이므로 정리 필요
 */
export async function pruneOldIndices(es: Client, alias: string, current: string, keep: number): Promise<string[]> {
  const res = await es.cat.indices({ index: `${alias}-*`, h: 'index', format: 'json' });
  const pattern = new RegExp(`^${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d{8}-\\d{6}$`);
  const older = res
    .map((r) => r.index!)
    .filter((i) => pattern.test(i) && i < current) // 이름의 시각 순 = 생성 순
    .sort()
    .reverse();
  const doomed = older.slice(keep);
  if (doomed.length) await es.indices.delete({ index: doomed });
  return doomed;
}
