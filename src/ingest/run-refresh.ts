/**
 * 매일 갱신을 지금 한 번 실행 (서버는 REFRESH_AT 시각에 자동 실행)
 *
 *   npm run refresh
 */
import { config } from '../config.js';
import { es } from '../es/client.js';
import { runRefresh } from './refresh.js';

if (!config.MOLIT_SERVICE_KEY) throw new Error('.env에 MOLIT_SERVICE_KEY를 설정하세요');
const status = await runRefresh({
  es, alias: config.ES_ALIAS, molitKey: config.MOLIT_SERVICE_KEY, kakaoKey: config.KAKAO_REST_API_KEY,
});
if (!status.ok) process.exitCode = 1;
