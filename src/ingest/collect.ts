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
import { parseArgs } from 'node:util';
import { config } from '../config.js';
import { collectMonths } from './collector.js';
import { currentYmd, monthRange } from './months.js';
import { resolveRegions } from './regions.js';

async function main() {
  const { values } = parseArgs({
    options: {
      regions: { type: 'string', default: 'seoul' },
      from: { type: 'string' },
      to: { type: 'string', default: currentYmd() },
      'refresh-recent': { type: 'string', default: '0' },
      concurrency: { type: 'string', default: '2' },
    },
  });

  if (!config.MOLIT_SERVICE_KEY) throw new Error('.env에 MOLIT_SERVICE_KEY를 설정하세요');
  if (!values.from) throw new Error('--from YYYYMM 이 필요합니다');

  const months = monthRange(values.from, values.to!);
  const n = Number(values['refresh-recent']);
  const result = await collectMonths({
    serviceKey: config.MOLIT_SERVICE_KEY,
    regions: resolveRegions(values.regions!),
    months,
    refresh: new Set(n > 0 ? months.slice(-n) : []),
    concurrency: Number(values.concurrency),
  });

  console.log(`\n완료: ${result.done}건 작업, 거래 ${result.rows.toLocaleString()}건 저장`);
  if (result.failed.length) {
    console.warn(`실패 ${result.failed.length}건 (다시 실행하면 재시도):\n  ${result.failed.join('\n  ')}`);
  }
  if (result.aborted) {
    console.error(`중단: ${result.aborted.message}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
