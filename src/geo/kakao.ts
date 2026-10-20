/**
 * 카카오 로컬 API — 주소 검색 (주소 → 좌표)
 * https://developers.kakao.com/docs/latest/ko/local/dev-guide#address-coord
 */
export const KAKAO_ADDRESS_ENDPOINT = 'https://dapi.kakao.com/v2/local/search/address.json';

export interface LatLon {
  lat: number;
  lon: number;
}

/** 키 오류 등 재시도해도 실패하는 에러 */
export class KakaoFatalError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 주소 → 좌표. 결과가 없으면 null */
export async function geocodeAddress(apiKey: string, query: string, retries = 3): Promise<LatLon | null> {
  const url = new URL(KAKAO_ADDRESS_ENDPOINT);
  url.searchParams.set('query', query);
  url.searchParams.set('size', '1');

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: `KakaoAK ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    }).catch((err: Error) => err);

    if (res instanceof Response && res.ok) {
      const body = (await res.json()) as { documents: Array<{ x: string; y: string }> };
      const doc = body.documents[0];
      // 카카오는 x = 경도, y = 위도
      return doc ? { lat: Number(doc.y), lon: Number(doc.x) } : null;
    }
    if (res instanceof Response && (res.status === 401 || res.status === 403)) {
      throw new KakaoFatalError(`카카오 API ${res.status}: ${await res.text()}`);
    }
    if (attempt >= retries) {
      throw res instanceof Response ? new Error(`카카오 API ${res.status}`) : res;
    }
    await sleep(1000 * 2 ** attempt); // 429·5xx·네트워크 오류
  }
}
