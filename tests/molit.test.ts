import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MolitFatalError, MolitRetryableError, parseTradeXml } from '../src/ingest/molit.js';

const fixture = readFileSync(new URL('./fixtures/trade-page.xml', import.meta.url), 'utf8');

describe('parseTradeXml', () => {
  it('여러 건 응답을 배열로 파싱하고 값은 문자열로 유지한다', () => {
    const page = parseTradeXml(fixture);
    expect(page.totalCount).toBe(2);
    expect(page.items).toHaveLength(2);
    expect(page.items[0]?.aptNm).toBe('래미안퍼스티지');
    expect(page.items[0]?.sggCd).toBe('11650');
    expect(typeof page.items[0]?.buildYear).toBe('string');
  });

  it('1건 응답(객체)도 배열로 정규화한다', () => {
    const xml = `<response><header><resultCode>000</resultCode></header><body><items><item><aptNm>A</aptNm></item></items><totalCount>1</totalCount></body></response>`;
    expect(parseTradeXml(xml).items).toEqual([{ aptNm: 'A' }]);
  });

  it('0건 응답은 빈 배열', () => {
    const xml = `<response><header><resultCode>000</resultCode></header><body><items></items><totalCount>0</totalCount></body></response>`;
    expect(parseTradeXml(xml).items).toEqual([]);
  });

  it('인증키 오류는 재시도하지 않는 에러로 분류한다', () => {
    const xml = `<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>`;
    expect(() => parseTradeXml(xml)).toThrow(MolitFatalError);
  });

  it('그 외 resultCode 오류는 재시도 대상', () => {
    const xml = `<response><header><resultCode>99</resultCode><resultMsg>ERR</resultMsg></header></response>`;
    expect(() => parseTradeXml(xml)).toThrow(MolitRetryableError);
  });
});
