import type { estypes } from '@elastic/elasticsearch';
import { z } from 'zod';

export const SearchParamsSchema = z.object({
  q: z.string().trim().max(100).optional(),
  sggCd: z.string().regex(/^\d{5}$/).optional(),
  minPrice: z.coerce.number().int().nonnegative().optional(), // 만원
  maxPrice: z.coerce.number().int().positive().optional(),
  minArea: z.coerce.number().nonnegative().optional(), // ㎡
  maxArea: z.coerce.number().positive().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // 계약일
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // z.coerce.boolean()은 "false" 문자열도 true로 바꾸므로 명시적으로 처리
  includeCanceled: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  page: z.coerce.number().int().min(1).max(100).default(1),
  size: z.coerce.number().int().min(1).max(50).default(20),
});

export type SearchParams = z.infer<typeof SearchParamsSchema>;

/**
 * 1주차 기본 검색: BM25 multi_match + 필터
 * - 텍스트 매칭은 must(점수 반영), 조건은 filter(점수 무관·캐시됨)
 */
export function buildSearchRequest(p: SearchParams): Omit<estypes.SearchRequest, 'index'> {
  const filter: estypes.QueryDslQueryContainer[] = [];

  if (p.sggCd) filter.push({ term: { sggCd: p.sggCd } });
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

  const must: estypes.QueryDslQueryContainer[] = p.q
    ? [
        {
          multi_match: {
            query: p.q,
            // 단지명 > 동 이름 > 도로명 > 전체 주소 순으로 가중치
            fields: ['aptName^4', 'umdName.text^2', 'roadName.text^1.5', 'address'],
            type: 'best_fields',
            operator: 'and',
          },
        },
      ]
    : [{ match_all: {} }];

  return {
    query: { bool: { must, filter } },
    sort: p.q
      ? [{ _score: { order: 'desc' } }, { dealDate: { order: 'desc' } }]
      : [{ dealDate: { order: 'desc' } }],
    from: (p.page - 1) * p.size,
    size: p.size,
    track_total_hits: true,
  };
}
