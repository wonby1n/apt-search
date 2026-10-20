/// <reference types="vite/client" />
/**
 * 실제 ES(+nori)에 대한 검색 품질 회귀 테스트. ES가 떠 있어야 하므로 기본 `npm test`에선 건너뜀.
 *
 *   npm run es:up && npm run test:it
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { es } from '../src/es/client.js';
import { indexMappings, indexSettings } from '../src/es/mapping.js';
import {
  AutocompleteParamsSchema,
  buildAutocompleteRequest,
  buildSearchRequest,
  SearchParamsSchema,
} from '../src/search/query.js';

const INDEX = 'apt-trades-it';

const NAMES = [
  '래미안퍼스티지', '래미안대치팰리스', '아크로리버파크', '디에이치아너힐즈', '헬리오시티', '힐스테이트서초젠트리스',
  '올림픽파크포레온', '경희궁자이', '반포자이', '잠실엘스', '도곡렉슬', '롯데캐슬골드', '래미안원베일리',
  'e편한세상옥수파크힐스', 'DMC파크뷰자이', '은마',
];

// 단지당 거래 3건 → 자동완성이 단지 단위로 묶이는지 확인
const docs = NAMES.flatMap((aptName, i) =>
  [1, 2, 3].map((n) => ({
    aptName,
    complexId: `c${i}`,
    sggCd: '11650',
    address: aptName,
    dealDate: `2024-0${n}-01`,
    dealAmount: 100000,
    area: 84,
    canceled: false,
  })),
);

const search = async (q: string) => {
  const res = await es.search<{ aptName: string }>({
    index: INDEX,
    ...buildSearchRequest(SearchParamsSchema.parse({ q, size: 50 })),
  });
  return new Set(res.hits.hits.map((h) => h._source!.aptName));
};

const autocomplete = async (q: string) => {
  const res = await es.search<{ aptName: string }>({
    index: INDEX,
    ...buildAutocompleteRequest(AutocompleteParamsSchema.parse({ q })),
  });
  return res.hits.hits.map((h) => h._source!.aptName);
};

describe.skipIf(import.meta.env.MODE !== 'it')('검색 품질 (ES 통합)', () => {
  beforeAll(async () => {
    await es.indices.delete({ index: INDEX }, { ignore: [404] });
    await es.indices.create({ index: INDEX, settings: indexSettings, mappings: indexMappings });
    await es.helpers.bulk({ datasource: docs, onDocument: () => ({ index: { _index: INDEX } }), refresh: 'wait_for' });
  });

  afterAll(async () => {
    await es.indices.delete({ index: INDEX }, { ignore: [404] });
  });

  it.each([
    ['퍼스티지', '래미안퍼스티지'],
    ['퍼스티', '래미안퍼스티지'], // 타이핑 중 — 형태소 분석으로는 못 잡음
    ['캐슬골드', '롯데캐슬골드'], // 형태소만으론 놓침 (사전에 "롯데캐슬"을 분해형 없이 등록했을 때)
    ['스테이트', '힐스테이트서초젠트리스'],
    ['원베일리', '래미안원베일리'],
    ['레미안', '래미안퍼스티지'], // 동의어
    ['이편한세상', 'e편한세상옥수파크힐스'], // 동의어
  ])('검색 "%s" → %s', async (q, want) => {
    expect(await search(q)).toContain(want);
  });

  it.each(['래미안퍼스티지', '레미안퍼스티지', '롯데캐슬골드'])(
    '단지명 전체("%s")가 n-gram 없이 형태소 필드만으로도 매칭된다',
    async (q) => {
      // mixed 토크나이저 + synonym_graph 조합이면 쿼리가 빈 Synonym()이 되어 0건 (n-gram이 가려서 안 보였음)
      const res = await es.count({ index: INDEX, query: { match: { aptName: { query: q, operator: 'and' } } } });
      expect(res.count).toBeGreaterThan(0);
    },
  );

  it('부분 일치 fallback이 엉뚱한 단지를 끌어오지 않는다', async () => {
    expect([...(await search('퍼스티지'))]).toEqual(['래미안퍼스티지']);
  });

  it.each([
    ['래미', '래미안퍼스티지'],
    ['퍼스', '래미안퍼스티지'], // 단어 중간부터 입력
    ['원베', '래미안원베일리'],
    ['리버파', '아크로리버파크'],
    ['dmc', 'DMC파크뷰자이'], // 대소문자 무시
    ['은', '은마'], // 1글자 (n-gram 최소 2글자)
  ])('자동완성 "%s" → %s', async (q, want) => {
    expect(await autocomplete(q)).toContain(want);
  });

  it('자동완성은 앞부분 일치를 먼저, 단지당 한 번만 보여준다', async () => {
    const items = await autocomplete('래미안');
    expect(items).toHaveLength(new Set(items).size);
    expect(items.slice(0, 3).every((n) => n.startsWith('래미안'))).toBe(true);
  });
});
