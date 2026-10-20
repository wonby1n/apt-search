/**
 * data/raw → 새 버전 인덱스에 bulk 색인 → alias 교체 (무중단 재색인)
 *
 *   npm run index
 *   npm run index -- --delete-old
 */
import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { config } from '../config.js';
import { es } from '../es/client.js';
import { createVersionedIndex, swapAlias } from '../es/indices.js';
import type { RawTrade } from './molit.js';
import { transformTrade, type TradeDoc } from './transform.js';

const RAW_DIR = join(process.cwd(), 'data', 'raw');

interface Stats {
  read: number;
  skipped: number;
  skipReasons: Map<string, number>;
}

async function* readDocs(stats: Stats): AsyncGenerator<{ id: string; doc: TradeDoc }> {
  const regionDirs = (await readdir(RAW_DIR, { withFileTypes: true })).filter((d) => d.isDirectory());
  for (const dir of regionDirs) {
    const files = (await readdir(join(RAW_DIR, dir.name))).filter((f) => f.endsWith('.ndjson')).sort();
    for (const file of files) {
      const rl = createInterface({ input: createReadStream(join(RAW_DIR, dir.name, file)) });
      for await (const line of rl) {
        if (!line.trim()) continue;
        stats.read++;
        const result = transformTrade(JSON.parse(line) as RawTrade, dir.name);
        if (result.ok) {
          yield { id: result.id, doc: result.doc };
        } else {
          stats.skipped++;
          stats.skipReasons.set(result.reason, (stats.skipReasons.get(result.reason) ?? 0) + 1);
        }
      }
    }
  }
}

async function main() {
  const { values } = parseArgs({ options: { 'delete-old': { type: 'boolean', default: false } } });
  const alias = config.ES_ALIAS;

  const index = await createVersionedIndex(es, alias);
  console.log(`새 인덱스 생성: ${index}`);

  const stats: Stats = { read: 0, skipped: 0, skipReasons: new Map() };
  const started = Date.now();
  const docs = readDocs(stats);

  const result = await es.helpers.bulk<{ id: string; doc: TradeDoc }>({
    datasource: docs,
    flushBytes: 5_000_000,
    concurrency: 4,
    // [action, payload] 튜플을 반환하면 payload가 문서 본문이 됨 (id는 본문에서 제외)
    onDocument: (d) => [{ index: { _index: index, _id: d.id } }, d.doc],
    onDrop: (dropped) => {
      console.warn('색인 실패:', dropped.error?.reason ?? dropped.error, dropped.document);
    },
  });

  const sec = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `원본 ${stats.read.toLocaleString()}건 → 색인 ${result.successful.toLocaleString()}건, ` +
      `실패 ${result.failed}건, 변환 제외 ${stats.skipped}건 (${sec}s)`,
  );
  for (const [reason, n] of stats.skipReasons) console.log(`  - 제외 사유 "${reason}": ${n}건`);

  if (result.failed > 0 && result.successful === 0) {
    throw new Error('색인 성공 건이 없어 alias 교체를 중단합니다');
  }

  const old = await swapAlias(es, alias, index, { deleteOld: values['delete-old'] });
  console.log(`alias "${alias}" → ${index}` + (old.length ? ` (이전: ${old.join(', ')}${values['delete-old'] ? ', 삭제됨' : ''})` : ''));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
