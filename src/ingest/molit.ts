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

const parser = new XMLParser({
  parseTagValue: false, // "00123" 같은 값이 숫자로 바뀌지 않도록 전부 문자열 유지
  trimValues: true,
  ignoreAttributes: true,
});

const FATAL_AUTH_CODES = new Set(['20', '22', '30', '31', '32', '33']);

export function parseTradeXml(xml: string): TradePage {
  const doc = parser.parse(xml) as Record<string, any>;

  // 게이트웨이 레벨 에러 (인증키 미등록, 트래픽 초과 등)
  const gw = doc.OpenAPI_ServiceResponse?.cmmMsgHeader;
  if (gw) {
    const code = String(gw.returnReasonCode ?? '');
    const msg = `${gw.returnAuthMsg ?? gw.errMsg ?? 'UNKNOWN'} (code ${code})`;
    if (FATAL_AUTH_CODES.has(code)) throw new MolitFatalError(msg);
    throw new MolitRetryableError(msg);
  }

  const res = doc.response;
  if (!res) throw new MolitRetryableError('예상하지 못한 응답 형식');

  const resultCode = String(res.header?.resultCode ?? '');
  if (resultCode !== '000' && resultCode !== '00') {
    throw new MolitRetryableError(`${res.header?.resultMsg ?? 'ERROR'} (resultCode ${resultCode})`);
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
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (res.status >= 500) throw new MolitRetryableError(`HTTP ${res.status}`);
      if (!res.ok) throw new MolitFatalError(`HTTP ${res.status}`);
      return parseTradeXml(await res.text());
    } catch (err) {
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
