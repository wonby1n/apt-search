/**
 * 실거래가 원본 수집 → data/raw/{LAWD_CD}/{YYYYMM}.ndjson
 *
 *   npm run collect -- --regions seoul --from 202401 --to 202409
 *   npm run collect -- --regions 11680,11650 --from 202301 --refresh-recent 2
 *
 * - 이미 받은 (지역, 월) 파일은 건너뜀 → 중간에 끊겨도 이어받기, 일일 트래픽(개발계정 10,000건) 절약
 * - 실거래 신고기한(30일)과 해제 신고 때문에 최근 월은 데이터가 계속 바뀜 → --refresh-recent N 으로 최근 N개월 재수집
 * - 원본(raw)을 저장해 두므로 매핑/변환 로직을 바꿔도 API 재호출 없이 재색인 가능
 */
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { config } from '../config.js';
import { fetchMonth, MolitFatalError } from './molit.js';
import { currentYmd, monthRange } from './months.js';
import { resolveRegions } from './regions.js';

const RAW_DIR = join(process.cwd(), 'data', 'raw');

async function main() {
  const { values } = parseArgs({
    options: {
      regions: { type: 'string', default: 'seoul' },
      from: { type: 'string' },
      to: { type: 'string', default: currentYmd() },
      'refresh-recent': { type: 'string', default: '0' },
      concurrency: { type: 'string', default: '4' },
    },
  });

  if (!config.MOLIT_SERVICE_KEY) throw new Error('.env에 MOLIT_SERVICE_KEY를 설정하세요');
  if (!values.from) throw new Error('--from YYYYMM 이 필요합니다');

  const regions = resolveRegions(values.regions!);
  const months = monthRange(values.from, values.to!);
  const refreshFrom = months.slice(-Number(values['refresh-recent']));
  const refreshSet = new Set(Number(values['refresh-recent']) > 0 ? refreshFrom : []);

  type Job = { lawdCd: string; label: string; ymd: string; file: string };
  const jobs: Job[] = [];
  for (const r of regions) {
    const dir = join(RAW_DIR, r.lawdCd);
    await mkdir(dir, { recursive: true });
    const existing = new Set(await readdir(dir));
    for (const ymd of months) {
      const name = `${ymd}.ndjson`;
      if (existing.has(name) && !refreshSet.has(ymd)) continue;
      jobs.push({ lawdCd: r.lawdCd, label: `${r.sido} ${r.sgg}`, ymd, file: join(dir, name) });
    }
  }

  console.log(`지역 ${regions.length}개 × ${months.length}개월 중 수집할 작업 ${jobs.length}건`);

  let done = 0;
  let rows = 0;
  let aborted: Error | null = null;
  const failed: string[] = [];

  const worker = async () => {
    while (jobs.length > 0 && !aborted) {
      const job = jobs.shift()!;
      try {
        const items = await fetchMonth({
          serviceKey: config.MOLIT_SERVICE_KEY,
          lawdCd: job.lawdCd,
          dealYmd: job.ymd,
        });
        await writeFile(job.file, items.map((i) => JSON.stringify(i)).join('\n') + (items.length ? '\n' : ''));
        rows += items.length;
        done++;
        console.log(`[${done}] ${job.label} ${job.ymd}: ${items.length}건`);
      } catch (err) {
        if (err instanceof MolitFatalError) {
          aborted = err; // 인증키 오류·트래픽 초과는 계속 호출해 봐야 의미 없음
          return;
        }
        failed.push(`${job.lawdCd}/${job.ymd}: ${(err as Error).message}`);
      }
    }
  };

  await Promise.all(Array.from({ length: Number(values.concurrency) }, worker));

  console.log(`\n완료: ${done}건 작업, 거래 ${rows.toLocaleString()}건 저장`);
  if (failed.length) console.warn(`실패 ${failed.length}건 (다시 실행하면 재시도):\n  ${failed.join('\n  ')}`);
  if (aborted) {
    console.error(`중단: ${(aborted as Error).message}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
