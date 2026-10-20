import { describe, expect, it } from 'vitest';
import { buildSearchRequest, SearchParamsSchema } from '../src/search/query.js';
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

  it('검색에 쓰는 필드가 매핑에 존재한다', () => {
    const req = buildSearchRequest(SearchParamsSchema.parse({ q: 'x' }));
    const fields: string[] = (req.query as any).bool.must[0].multi_match.fields;
    for (const f of fields) {
      const [root, sub] = f.replace(/\^.*$/, '').split('.');
      const prop: any = indexMappings.properties![root!];
      expect(prop, f).toBeDefined();
      if (sub) expect(prop.fields?.[sub], f).toBeDefined();
    }
  });
});
