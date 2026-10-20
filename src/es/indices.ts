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
