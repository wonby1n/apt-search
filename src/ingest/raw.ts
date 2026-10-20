import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { RawTrade } from './molit.js';
import { transformTrade, type TradeDoc } from './transform.js';

export const RAW_DIR = join(process.cwd(), 'data', 'raw');

export interface ReadStats {
  read: number;
  skipped: number;
  skipReasons: Map<string, number>;
}

export const newReadStats = (): ReadStats => ({ read: 0, skipped: 0, skipReasons: new Map() });

/** data/raw/{LAWD_CD}/{YYYYMM}.ndjson 을 읽어 변환된 문서를 하나씩 내보낸다 (변환 실패는 stats에 집계) */
export async function* readTrades(
  stats: ReadStats = newReadStats(),
): AsyncGenerator<{ id: string; doc: TradeDoc; raw: RawTrade }> {
  const regionDirs = (await readdir(RAW_DIR, { withFileTypes: true })).filter((d) => d.isDirectory());
  for (const dir of regionDirs) {
    const files = (await readdir(join(RAW_DIR, dir.name))).filter((f) => f.endsWith('.ndjson')).sort();
    for (const file of files) {
      const rl = createInterface({ input: createReadStream(join(RAW_DIR, dir.name, file)) });
      for await (const line of rl) {
        if (!line.trim()) continue;
        stats.read++;
        const raw = JSON.parse(line) as RawTrade;
        const result = transformTrade(raw, dir.name);
        if (result.ok) {
          yield { id: result.id, doc: result.doc, raw };
        } else {
          stats.skipped++;
          stats.skipReasons.set(result.reason, (stats.skipReasons.get(result.reason) ?? 0) + 1);
        }
      }
    }
  }
}
