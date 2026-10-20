/**
 * data/raw의 단지들을 카카오 주소 검색으로 지오코딩 → data/geo/complexes.ndjson
 *
 *   npm run geocode
 *   npm run geocode -- --retry-miss   # 못 찾았던 단지 다시 시도
 *
 * - 거래(수십만 건)가 아니라 단지(수천 개) 단위로 호출
 * - 이미 캐시된 단지는 건너뜀 → 재실행하면 새로 생긴 단지만 호출
 * - 결과는 다음 npm run index 때 location으로 들어감
 */
import { parseArgs } from 'node:util';
import { config } from '../config.js';
import { geocodeComplexes } from './geocoder.js';

async function main() {
  const { values } = parseArgs({
    options: {
      'retry-miss': { type: 'boolean', default: false },
      concurrency: { type: 'string', default: '4' },
    },
  });
  if (!config.KAKAO_REST_API_KEY) throw new Error('.env에 KAKAO_REST_API_KEY를 설정하세요');

  const result = await geocodeComplexes({
    apiKey: config.KAKAO_REST_API_KEY,
    retryMiss: values['retry-miss'],
    concurrency: Number(values.concurrency),
  });
  console.log(`\n완료: 찾음 ${result.found}개, 못 찾음 ${result.missed}개`);
  if (result.aborted) {
    console.error(`중단: ${result.aborted.message}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
