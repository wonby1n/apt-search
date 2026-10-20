import { existsSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadFirstSeen, newIds, openFirstSeenWriter } from './first-seen.js';
import { fetchMonth, MolitFatalError, type RawTrade } from './molit.js';
import { readNdjson } from './ndjson.js';
import { RAW_DIR } from './raw.js';
import type { Region } from './regions.js';
import { tradeId } from './transform.js';

export interface CollectOptions {
  serviceKey: string;
  regions: Region[];
  months: string[];
  /** 이미 받은 파일이어도 다시 받을 월 (실거래 신고기한 30일·해제 신고 때문에 최근 월은 계속 바뀜) */
  refresh?: Set<string>;
  concurrency?: number;
  /** 지정하면 다시 받은 파일에서 새로 나타난 거래를 이 날짜로 first-seen에 기록 */
  firstSeenDate?: string;
  log?: (msg: string) => void;
}

export interface CollectResult {
  jobs: number;
  done: number;
  rows: number;
  newTrades: number;
  failed: string[];
  aborted: Error | null;
}

/** (지역, 월) 단위 수집 → data/raw/{LAWD_CD}/{YYYYMM}.ndjson. 이미 받은 파일은 refresh 대상이 아니면 건너뜀 */
export async function collectMonths(opts: CollectOptions): Promise<CollectResult> {
  const log = opts.log ?? console.log;
  const refresh = opts.refresh ?? new Set<string>();

  type Job = { lawdCd: string; label: string; ymd: string; file: string };
  const jobs: Job[] = [];
  for (const r of opts.regions) {
    const dir = join(RAW_DIR, r.lawdCd);
    await mkdir(dir, { recursive: true });
    const existing = new Set(await readdir(dir));
    for (const ymd of opts.months) {
      const name = `${ymd}.ndjson`;
      if (existing.has(name) && !refresh.has(ymd)) continue;
      jobs.push({ lawdCd: r.lawdCd, label: `${r.sido} ${r.sgg}`, ymd, file: join(dir, name) });
    }
  }
  log(`지역 ${opts.regions.length}개 × ${opts.months.length}개월 중 수집할 작업 ${jobs.length}건`);

  const seen = opts.firstSeenDate ? await loadFirstSeen() : null;
  const seenOut = opts.firstSeenDate ? await openFirstSeenWriter() : null;
  const result: CollectResult = { jobs: jobs.length, done: 0, rows: 0, newTrades: 0, failed: [], aborted: null };

  const worker = async () => {
    while (jobs.length > 0 && !result.aborted) {
      const job = jobs.shift()!;
      try {
        const items = await fetchMonth({ serviceKey: opts.serviceKey, lawdCd: job.lawdCd, dealYmd: job.ymd });

        let fresh = 0;
        if (seen && seenOut) {
          // 덮어쓰기 전에 직전 파일과 비교. 파일이 없던 월(새 달)은 전부 새 거래
          const before: string[] = [];
          if (existsSync(job.file)) for await (const r of readNdjson<RawTrade>(job.file)) before.push(tradeId(r));
          for (const id of newIds(before, items.map(tradeId))) {
            if (seen.has(id)) continue;
            seen.set(id, opts.firstSeenDate!);
            seenOut.append({ id, date: opts.firstSeenDate! });
            fresh++;
          }
          result.newTrades += fresh;
        }

        await writeFile(job.file, items.map((i) => JSON.stringify(i)).join('\n') + (items.length ? '\n' : ''));
        result.rows += items.length;
        result.done++;
        log(`[${result.done}] ${job.label} ${job.ymd}: ${items.length}건` + (seen ? ` (신규 ${fresh})` : ''));
      } catch (err) {
        if (err instanceof MolitFatalError) {
          result.aborted = err; // 인증키 오류·트래픽 초과는 계속 호출해 봐야 의미 없음
          return;
        }
        result.failed.push(`${job.lawdCd}/${job.ymd}: ${(err as Error).message}`);
      }
    }
  };

  // 4로 두면 연속 ~45회 만에 초당 요청 제한(429)에 걸림
  await Promise.all(Array.from({ length: opts.concurrency ?? 2 }, worker));
  await seenOut?.close();
  return result;
}

/** 이미 수집해 둔 지역 (data/raw 하위 폴더) */
export async function collectedRegionCodes(): Promise<string[]> {
  if (!existsSync(RAW_DIR)) return [];
  return (await readdir(RAW_DIR, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
}
