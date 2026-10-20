import { describe, expect, it } from 'vitest';
import {
  AutocompleteParamsSchema,
  buildAutocompleteRequest,
  buildHomeRequest,
  buildSearchRequest,
  SearchParamsSchema,
} from '../src/search/query.js';
import { indexMappings } from '../src/es/mapping.js';

describe('buildSearchRequest', () => {
  it('검색어 없으면 최신 계약일순 + 해제거래 제외', () => {
    const req = buildSearchRequest(SearchParamsSchema.parse({}));
    expect(req.sort).toEqual([{ dealDate: { order: 'desc' } }]);
    expect(JSON.stringify(req.query)).toContain('"canceled":false');
  });

  it('includeCanceled=false 문자열은 false로 해석', () => {
    expect(SearchParamsSchema.parse({ includeCanceled: 'false' }).includeCanceled).toBe(false);
    expect(SearchParamsSchema.parse({ includeCanceled: 'true' }).includeCanceled).toBe(true);
  });

  it('쿼리스트링 숫자를 변환하고 필터를 만든다', () => {
    const req = buildSearchRequest(
      SearchParamsSchema.parse({ q: '래미안', sggCd: '11650', minPrice: '100000', page: '2', size: '10' }),
    );
    expect(req.from).toBe(10);
    const filters = (req.query as any).bool.filter;
    expect(filters).toContainEqual({ term: { sggCd: '11650' } });
    expect(filters).toContainEqual({ range: { dealAmount: { gte: 100000, lte: undefined } } });
  });

  it('반경 검색: geo_distance 필터 + 검색어 없으면 가까운 순', () => {
    const req = buildSearchRequest(SearchParamsSchema.parse({ lat: '37.5', lon: '127.0', radiusKm: '1.5' }));
    expect((req.query as any).bool.filter).toContainEqual({
      geo_distance: { distance: '1.5km', location: { lat: 37.5, lon: 127 } },
    });
    expect(Object.keys((req.sort as object[])[0]!)).toEqual(['_geo_distance']);
  });

  it('지도용으로 단지별 집계를 함께 요청한다', () => {
    const req = buildSearchRequest(SearchParamsSchema.parse({ q: '래미안' }));
    expect((req.aggs as any).complexes.terms.field).toBe('complexId');
    expectMapped('complexId');
  });

  it('검색어가 있으면 하이라이트·점수, 최신순이면 계약일 먼저', () => {
    const rel = buildSearchRequest(SearchParamsSchema.parse({ q: '래미안' }));
    expect(rel.track_scores).toBe(true);
    expect(Object.keys((rel.highlight as any).fields)).toContain('aptName.ngram');
    expect(Object.keys((rel.sort as object[])[0]!)).toEqual(['_score']);
    const recent = buildSearchRequest(SearchParamsSchema.parse({ q: '래미안', sort: 'recent' }));
    expect(Object.keys((recent.sort as object[])[0]!)).toEqual(['dealDate']);
  });

  it('신규 공개 필터: 처음 본 날짜 기준 필터 + 최신 공개순', () => {
    const req = buildSearchRequest(SearchParamsSchema.parse({ firstSeenFrom: '2026-10-21' }));
    expect((req.query as any).bool.filter).toContainEqual({ range: { firstSeenDate: { gte: '2026-10-21' } } });
    expect(req.sort).toEqual([{ firstSeenDate: { order: 'desc' } }, { dealDate: { order: 'desc' } }]);
    expectMapped('firstSeenDate');
  });

  it('자동완성에서 고른 단지만 보여준다', () => {
    const req = buildSearchRequest(SearchParamsSchema.parse({ complexId: '11650-2134' }));
    expect((req.query as any).bool.filter).toContainEqual({ term: { complexId: '11650-2134' } });
  });

  it('반경 검색 파라미터는 셋 다 있거나 셋 다 없어야 한다', () => {
    expect(SearchParamsSchema.safeParse({ lat: '37.5', lon: '127.0' }).success).toBe(false);
    expect(SearchParamsSchema.safeParse({ lat: '37.5', lon: '127.0', radiusKm: '50' }).success).toBe(false);
  });

  it('검색에 쓰는 필드가 매핑에 존재한다', () => {
    const req = buildSearchRequest(SearchParamsSchema.parse({ q: 'x' }));
    const fields: string[] = (req.query as any).bool.must[0].multi_match.fields;
    for (const f of fields) expectMapped(f);
  });
});

describe('buildAutocompleteRequest', () => {
  it('빈 검색어는 거부한다', () => {
    expect(AutocompleteParamsSchema.safeParse({ q: '  ' }).success).toBe(false);
  });

  it('단지 단위로 collapse하고 지역 필터를 건다', () => {
    const req = buildAutocompleteRequest(AutocompleteParamsSchema.parse({ q: '래미', sggCd: '11650' }));
    expect(req.collapse).toEqual({ field: 'complexId' });
    expect(req.size).toBe(10);
    expect((req.query as any).bool.filter).toEqual([{ term: { sggCd: '11650' } }]);
  });

  it('자동완성에 쓰는 필드가 매핑에 존재한다', () => {
    const req = buildAutocompleteRequest(AutocompleteParamsSchema.parse({ q: 'x' }));
    const should: any[] = (req.query as any).bool.should;
    for (const clause of should) expectMapped(Object.keys(Object.values(clause)[0] as object)[0]!);
    expectMapped(req.collapse!.field);
  });
});

function expectMapped(field: string) {
  const [root, sub] = field.replace(/\^.*$/, '').split('.');
  const prop: any = indexMappings.properties![root!];
  expect(prop, field).toBeDefined();
  if (sub) expect(prop.fields?.[sub], field).toBeDefined();
}

describe('buildHomeRequest', () => {
  it('최근 N일 계약 · 해제 제외 · 집계 필드가 매핑에 있다', () => {
    const req = buildHomeRequest(30);
    expect((req.query as any).bool.filter).toEqual([
      { range: { dealDate: { gte: 'now-30d/d' } } },
      { term: { canceled: false } },
    ]);
    expectMapped((req.aggs as any).avgPricePerPyeong.avg.field);
    expectMapped((req.aggs as any).busiest.terms.field);
  });
});
