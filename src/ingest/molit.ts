import { XMLParser } from 'fast-xml-parser';

/**
 * 국토교통부_아파트 매매 실거래가 상세 자료 (data.go.kr/data/15126468)
 * 응답 item의 원본 필드. 값은 전부 문자열(공백 패딩 포함)로 온다.
 */
export interface RawTrade {
  aptNm?: string;
  aptSeq?: string;
  aptDong?: string;
  buildYear?: string;
  dealAmount?: string; // "  82,500" (만원)
  dealYear?: string;
  dealMonth?: string;
  dealDay?: string;
  excluUseAr?: string; // 전용면적 ㎡
  floor?: string;
  sggCd?: string;
  umdNm?: string;
  jibun?: string;
  roadNm?: string;
  cdealType?: string; // 해제여부 "O"
  cdealDay?: string; // 해제사유발생일 "24.03.15"
  dealingGbn?: string; // 중개거래 / 직거래
  buyerGbn?: string;
  slerGbn?: string;
  [key: string]: string | undefined;
}

export interface TradePage {
  items: RawTrade[];
  totalCount: number;
  pageNo: number;
  numOfRows: number;
}

export const MOLIT_ENDPOINT =
  'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev';

/** 재시도해도 소용없는 에러 (인증키·트래픽 초과 등) */
export class MolitFatalError extends Error {}
/** 일시적 에러 → 재시도 대상 */
export class MolitRetryableError extends Error {}
/**
 * 초당 요청 제한 초과 (HTTP 429, 코드 23 — 기술문서 에러표엔 없음)
 * 실측: 연속 ~45회 호출 후 차단, 1~2분 뒤 풀림 → 길게 기다렸다 재시도
 */
export class MolitRateLimitError extends MolitRetryableError {}
const RATE_LIMIT_CODE = '23';

const parser = new XMLParser({
  parseTagValue: false, // "00123" 같은 값이 숫자로 바뀌지 않도록 전부 문자열 유지
  trimValues: true,
  ignoreAttributes: true,
});

/**
 * 기술문서(docs/) 에러 코드
 * - 01·02·04·05: 제공기관 장애 → 재시도
 * - 03: 데이터 없음 → 에러가 아니라 0건
 * - 10·11·12: 요청 파라미터·URL 오류, 20·22·30·31·32: 승인·트래픽·인증키 → 재시도해도 실패하므로 중단
 */
const FATAL_CODES = new Set(['10', '11', '12', '20', '22', '30', '31', '32', '33']);
const NO_DATA_CODE = '03';

/** resultCode는 "000"(3자리), 에러 코드표는 "03"(2자리) → 2자리로 맞춤 */
const normalizeCode = (v: unknown) => String(v ?? '').trim().replace(/^0(?=\d{2}$)/, '');

const emptyPage = (): TradePage => ({ items: [], totalCount: 0, pageNo: 1, numOfRows: 0 });

export function parseTradeXml(xml: string): TradePage {
  const doc = parser.parse(xml) as Record<string, any>;

  // 게이트웨이 레벨 에러 (인증키 미등록, 트래픽 초과 등)
  const gw = doc.OpenAPI_ServiceResponse?.cmmMsgHeader;
  if (gw) {
    const code = normalizeCode(gw.returnReasonCode);
    if (code === NO_DATA_CODE) return emptyPage();
    const msg = `${gw.returnAuthMsg ?? gw.errMsg ?? 'UNKNOWN'} (code ${code})`;
    if (code === RATE_LIMIT_CODE) throw new MolitRateLimitError(msg);
    if (FATAL_CODES.has(code)) throw new MolitFatalError(msg);
    throw new MolitRetryableError(msg);
  }

  const res = doc.response;
  if (!res) throw new MolitRetryableError('예상하지 못한 응답 형식');

  const resultCode = normalizeCode(res.header?.resultCode);
  if (resultCode === NO_DATA_CODE) return emptyPage();
  if (resultCode !== '00') {
    const msg = `${res.header?.resultMsg ?? 'ERROR'} (resultCode ${resultCode})`;
    throw FATAL_CODES.has(resultCode) ? new MolitFatalError(msg) : new MolitRetryableError(msg);
  }

  const body = res.body ?? {};
  const rawItems = body.items?.item; // 0건이면 items가 "", 1건이면 객체, 여러 건이면 배열
  const items: RawTrade[] = rawItems == null ? [] : Array.isArray(rawItems) ? rawItems : [rawItems];

  return {
    items,
    totalCount: Number(body.totalCount ?? 0),
    pageNo: Number(body.pageNo ?? 1),
    numOfRows: Number(body.numOfRows ?? items.length),
  };
}

export interface FetchOptions {
  serviceKey: string;
  lawdCd: string;
  dealYmd: string; // YYYYMM
  numOfRows?: number;
  retries?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(opts: FetchOptions, pageNo: number): Promise<TradePage> {
  const url = new URL(MOLIT_ENDPOINT);
  // 공공데이터포털 Decoding 키를 넣으면 URLSearchParams가 알아서 인코딩함
  url.searchParams.set('serviceKey', opts.serviceKey);
  url.searchParams.set('LAWD_CD', opts.lawdCd);
  url.searchParams.set('DEAL_YMD', opts.dealYmd);
  url.searchParams.set('pageNo', String(pageNo));
  url.searchParams.set('numOfRows', String(opts.numOfRows ?? 1000));

  const maxRetries = opts.retries ?? 3;
  for (let attempt = 0, limited = 0; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (res.status === 429) {
        // 본문에 코드 23이 오지만 HTTP 상태만으로 판단
        throw new MolitRateLimitError(`HTTP 429 ${(await res.text()).match(/<errMsg>(.*?)<\/errMsg>/)?.[1] ?? ''}`.trim());
      }
      if (res.status >= 500) throw new MolitRetryableError(`HTTP ${res.status}`);
      if (!res.ok) throw new MolitFatalError(`HTTP ${res.status}`);
      return parseTradeXml(await res.text());
    } catch (err) {
      if (err instanceof MolitRateLimitError) {
        // 일반 재시도 횟수와 별개로 최대 6번 (15s → 30s → 60s → 60s …)
        if (++limited > 6) throw err;
        attempt--;
        await sleep(Math.min(15_000 * 2 ** (limited - 1), 60_000));
        continue;
      }
      if (err instanceof MolitFatalError || attempt >= maxRetries) throw err;
      await sleep(500 * 2 ** attempt); // 0.5s → 1s → 2s
    }
  }
}

/** 한 지역·한 달치 전체 페이지를 수집 */
export async function fetchMonth(opts: FetchOptions): Promise<RawTrade[]> {
  const first = await fetchPage(opts, 1);
  const all = [...first.items];
  const pages = Math.ceil(first.totalCount / (opts.numOfRows ?? 1000));
  for (let p = 2; p <= pages; p++) {
    all.push(...(await fetchPage(opts, p)).items);
  }
  return all;
}
