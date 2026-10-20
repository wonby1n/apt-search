/**
 * data/raw → 새 버전 인덱스에 bulk 색인 → alias 교체 (무중단 재색인)
 *
 *   npm run index                     # 이전 인덱스는 모두 남김 (롤백용)
 *   npm run index -- --keep 1         # 직전 1개만 남기고 오래된 버전 인덱스 삭제
 */
import { parseArgs } from 'node:util';
import { config } from '../config.js';
import { es } from '../es/client.js';
import { reindex } from './indexer.js';

async function main() {
  const { values } = parseArgs({ options: { keep: { type: 'string' } } });
  await reindex(es, config.ES_ALIAS, { keepPrevious: values.keep != null ? Number(values.keep) : undefined });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
