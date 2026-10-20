import type { estypes } from '@elastic/elasticsearch';
import { z } from 'zod';

export const SearchParamsSchema = z.object({
  q: z.string().trim().max(100).optional(),
  sggCd: z.string().regex(/^\d{5}$/).optional(),
  complexId: z.string().max(100).optional(), // 자동완성에서 고른 단지
  minPrice: z.coerce.number().int().nonnegative().optional(), // 만원
  maxPrice: z.coerce.number().int().positive().optional(),
  minArea: z.coerce.number().nonnegative().optional(), // ㎡
  maxArea: z.coerce.number().positive().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // 계약일
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  firstSeenFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // 이 날 이후 새로 공개된 거래
  // z.coerce.boolean()은 "false" 문자열도 true로 바꾸므로 명시적으로 처리
  includeCanceled: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  page: z.coerce.number().int().min(1).max(100).default(1),
  size: z.coerce.number().int().min(1).max(50).default(20),
  // 검색어가 있을 때: 관련도(BM25)순 또는 최신 계약순 (최신순이어도 점수는 계산해서 보여줌)
  sort: z.enum(['relevance', 'recent']).default('relevance'),
  // 반경 검색: 세 값을 함께 줘야 함
  lat: z.coerce.number().min(-90).max(90).optional(),
  lon: z.coerce.number().min(-180).max(180).optional(),
  radiusKm: z.coerce.number().positive().max(20).optional(),
}).refine((p) => [p.lat, p.lon, p.radiusKm].every((v) => v == null) || [p.lat, p.lon, p.radiusKm].every((v) => v != null), {
  message: 'lat, lon, radiusKm는 함께 지정해야 합니다',
  path: ['radiusKm'],
});

export type SearchParams = z.infer<typeof SearchParamsSchema>;

/**
 * 1주차 기본 검색: BM25 multi_match + 필터
 * - 텍스트 매칭은 must(점수 반영), 조건은 filter(점수 무관·캐시됨)
 */
/**
 * 단지명 > 동 이름 > 도로명 > 전체 주소 순으로 가중치
 * aptName.ngram: 형태소 분석이 다르게 쪼갠 부분 단지명 fallback ("캐슬골드" ⊂ "롯데캐슬골드")
 */
export const SEARCH_FIELDS = ['aptName^4', 'umdName.text^2', 'roadName.text^1.5', 'address', 'aptName.ngram'];

/** 검색어 매칭 쿼리 (/search와 /explain이 같은 쿼리를 써야 점수가 일치) */
export function textQuery(q: string): estypes.QueryDslQueryContainer {
  return { multi_match: { query: q, fields: SEARCH_FIELDS, type: 'best_fields', operator: 'and' } };
}

export function buildSearchRequest(p: SearchParams): Omit<estypes.SearchRequest, 'index'> {
  const filter: estypes.QueryDslQueryContainer[] = [];

  if (p.sggCd) filter.push({ term: { sggCd: p.sggCd } });
  if (p.complexId) filter.push({ term: { complexId: p.complexId } });
  if (!p.includeCanceled) filter.push({ term: { canceled: false } });
  if (p.minPrice != null || p.maxPrice != null) {
    filter.push({ range: { dealAmount: { gte: p.minPrice, lte: p.maxPrice } } });
  }
  if (p.minArea != null || p.maxArea != null) {
    filter.push({ range: { area: { gte: p.minArea, lte: p.maxArea } } });
  }
  if (p.from || p.to) {
    filter.push({ range: { dealDate: { gte: p.from, lte: p.to } } });
  }
  if (p.firstSeenFrom) filter.push({ range: { firstSeenDate: { gte: p.firstSeenFrom } } });

  // 거리 정렬 키. 검색어가 있으면 관련도 다음, 없으면 가까운 순이 기본
  const geo = p.lat != null && p.lon != null && p.radiusKm != null ? { lat: p.lat, lon: p.lon } : null;
  if (geo) filter.push({ geo_distance: { distance: `${p.radiusKm}km`, location: geo } });
  const byDistance: estypes.SortCombinations[] = geo
    ? [{ _geo_distance: { location: geo, order: 'asc', unit: 'km' } }]
    : [];

  const must: estypes.QueryDslQueryContainer[] = p.q ? [textQuery(p.q)] : [{ match_all: {} }];

  return {
    query: { bool: { must, filter } },
    sort: p.q
      ? p.sort === 'recent'
        ? [{ dealDate: { order: 'desc' } }, { _score: { order: 'desc' } }]
        : [{ _score: { order: 'desc' } }, ...byDistance, { dealDate: { order: 'desc' } }]
      : [
          ...byDistance,
          ...(p.firstSeenFrom ? [{ firstSeenDate: { order: 'desc' as const } }] : []),
          { dealDate: { order: 'desc' } },
        ],
    from: (p.page - 1) * p.size,
    size: p.size,
    track_total_hits: true,
    // 정렬을 직접 지정하면 max_score가 안 나오므로 → 점수 막대의 기준(최고점)용
    track_scores: !!p.q,
    // 어느 필드의 어느 부분이 일치했는지 (화면 하이라이트·"일치 필드" 표시)
    ...(p.q && {
      highlight: {
        number_of_fragments: 0,
        fields: Object.fromEntries(SEARCH_FIELDS.map((f) => [f.replace(/\^.*$/, ''), {}])),
      },
    }),
    // 지도용: 목록은 20건씩이지만 지도엔 조건에 맞는 단지를 전부 찍음 (거래 많은 단지 순 최대 300개)
    aggs: {
      complexes: {
        terms: { field: 'complexId', size: MAP_COMPLEX_LIMIT },
        aggs: {
          latest: {
            top_hits: {
              size: 1,
              sort: [{ dealDate: { order: 'desc' } }],
              _source: ['complexId', 'aptName', 'sggName', 'umdName', 'buildYear', 'location', 'dealDate', 'dealAmount', 'area'],
            },
          },
        },
      },
    },
  };
}

export const MAP_COMPLEX_LIMIT = 300;

export const AutocompleteParamsSchema = z.object({
  q: z.string().trim().min(1).max(50),
  sggCd: z.string().regex(/^\d{5}$/).optional(),
  size: z.coerce.number().int().min(1).max(20).default(10),
});

export type AutocompleteParams = z.infer<typeof AutocompleteParamsSchema>;

/**
 * 단지명 자동완성
 * - 앞부분 일치("래미") > 중간 일치("퍼스" → 래미안퍼스티지, n-gram) 순으로 점수
 * - 거래 문서가 단지당 수백 건이라 complexId로 collapse → 단지당 1건 (가장 최근 거래)
 */
export function buildAutocompleteRequest(p: AutocompleteParams): Omit<estypes.SearchRequest, 'index'> {
  return {
    query: {
      bool: {
        should: [
          { prefix: { 'aptName.keyword': { value: p.q, boost: 3, case_insensitive: true } } },
          { match: { 'aptName.ngram': { query: p.q, operator: 'and' } } },
          // 형태소 + 동의어 ("레미안" → 래미안). n-gram은 2글자부터라 1글자 입력도 여기서 받음
          { match: { aptName: { query: p.q, operator: 'and' } } },
        ],
        minimum_should_match: 1,
        filter: p.sggCd ? [{ term: { sggCd: p.sggCd } }] : [],
      },
    },
    collapse: { field: 'complexId' },
    sort: [{ _score: { order: 'desc' } }, { dealDate: { order: 'desc' } }],
    _source: ['complexId', 'aptName', 'sggName', 'umdName', 'buildYear', 'dealDate'],
    size: p.size,
    track_total_hits: false,
  };
}

/** 가장 최근 갱신에서 새로 공개된 날짜와 건수 (메인 화면용) */
export function buildLatestFirstSeenRequest(): Omit<estypes.SearchRequest, 'index'> {
  return {
    size: 0,
    query: { bool: { filter: [{ exists: { field: 'firstSeenDate' } }, { term: { canceled: false } }] } },
    aggs: {
      byDay: { terms: { field: 'firstSeenDate', order: { _key: 'desc' }, size: 1, format: 'yyyy-MM-dd' } },
    },
  };
}

const SUMMARY_SOURCE = ['complexId', 'aptName', 'sggName', 'umdName', 'buildYear', 'dealDate', 'dealAmount', 'area', 'floor'];

/**
 * 메인 화면 요약: 최근 N일 계약 거래 수·평균 평당가·최고가 거래·거래 많은 단지
 * 최근 계약일수록 아직 신고 전인 거래가 많아 숫자는 앞으로 늘어남 (신고기한 30일)
 */
export function buildHomeRequest(days = 30): Omit<estypes.SearchRequest, 'index'> {
  return {
    size: 0,
    track_total_hits: true,
    query: { bool: { filter: [{ range: { dealDate: { gte: `now-${days}d/d` } } }, { term: { canceled: false } }] } },
    aggs: {
      avgPricePerPyeong: { avg: { field: 'pricePerPyeong' } },
      topTrades: { top_hits: { size: 5, sort: [{ dealAmount: { order: 'desc' } }], _source: SUMMARY_SOURCE } },
      busiest: {
        terms: { field: 'complexId', size: 5 },
        aggs: { latest: { top_hits: { size: 1, sort: [{ dealDate: { order: 'desc' } }], _source: SUMMARY_SOURCE } } },
      },
    },
  };
}
