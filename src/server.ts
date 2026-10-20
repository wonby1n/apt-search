import { readFile } from 'node:fs/promises';
import type { estypes } from '@elastic/elasticsearch';
import Fastify from 'fastify';
import { z } from 'zod';
import { config } from './config.js';
import { es } from './es/client.js';
import { loadRefreshStatus, runRefresh, scheduleDailyRefresh, type RefreshDeps } from './ingest/refresh.js';
import {
  AutocompleteParamsSchema,
  buildAutocompleteRequest,
  buildHomeRequest,
  buildLatestFirstSeenRequest,
  buildSearchRequest,
  SearchParamsSchema,
  textQuery,
} from './search/query.js';
import { summarizeExplanation } from './search/explain.js';
import { ALL_REGIONS } from './ingest/regions.js';
import type { TradeDoc } from './ingest/transform.js';

const app = Fastify({ logger: true });

// 검색 화면 (빌드 없는 정적 HTML 한 장). 매 요청 읽어서 수정하면 새로고침만으로 반영
const INDEX_HTML = new URL('../public/index.html', import.meta.url);
app.get('/', async (_req, reply) => reply.type('text/html; charset=utf-8').send(await readFile(INDEX_HTML)));

app.get('/regions', async () => ALL_REGIONS);

// ---------- 매일 갱신 ----------
const refreshDeps: RefreshDeps = {
  es,
  alias: config.ES_ALIAS,
  molitKey: config.MOLIT_SERVICE_KEY,
  kakaoKey: config.KAKAO_REST_API_KEY,
  log: (m) => app.log.info(m),
};
const schedule =
  config.REFRESH_AT && config.MOLIT_SERVICE_KEY ? scheduleDailyRefresh(config.REFRESH_AT, refreshDeps) : null;

/** 마지막 갱신 결과 + 가장 최근 신규 공개일 */
app.get('/status', async () => {
  const res = await es.search({ index: config.ES_ALIAS, ...buildLatestFirstSeenRequest() });
  const day = (res.aggregations?.byDay as estypes.AggregationsStringTermsAggregate | undefined)?.buckets;
  const latest = Array.isArray(day) && day[0] ? { date: day[0].key_as_string ?? String(day[0].key), count: day[0].doc_count } : null;
  return {
    lastRefresh: await loadRefreshStatus(),
    nextRefreshAt: schedule?.nextAt().toISOString() ?? null,
    latestFirstSeen: latest,
  };
});

/** 메인 화면 요약 (최근 30일 계약) */
app.get('/home', async () => {
  const days = 30;
  const res = await es.search<TradeDoc>({ index: config.ES_ALIAS, ...buildHomeRequest(days) });
  const aggs = res.aggregations ?? {};
  const busiest = (aggs.busiest as estypes.AggregationsStringTermsAggregate | undefined)?.buckets;
  return {
    days,
    total: typeof res.hits.total === 'number' ? res.hits.total : (res.hits.total?.value ?? 0),
    avgPricePerPyeong: Math.round((aggs.avgPricePerPyeong as estypes.AggregationsAvgAggregate | undefined)?.value ?? 0),
    topTrades: (aggs.topTrades as estypes.AggregationsTopHitsAggregate | undefined)?.hits.hits.map((h) => h._source) ?? [],
    busiest: (Array.isArray(busiest) ? busiest : []).map((b) => ({
      ...((b.latest as estypes.AggregationsTopHitsAggregate).hits.hits[0]?._source as TradeDoc),
      count: b.doc_count,
    })),
  };
});

/** 수동 갱신 (로컬 개발용). 끝날 때까지 기다렸다 결과 반환 */
app.post('/refresh', async () => runRefresh(refreshDeps));

app.get('/health', async () => {
  const health = await es.cluster.health();
  return { es: health.status };
});

app.get('/search', async (req, reply) => {
  const parsed = SearchParamsSchema.safeParse(req.query);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'invalid_params', issues: parsed.error.issues });
  }

  const request = buildSearchRequest(parsed.data);
  const res = await es.search<TradeDoc>({ index: config.ES_ALIAS, ...request });
  const total = typeof res.hits.total === 'number' ? res.hits.total : (res.hits.total?.value ?? 0);
  // 반경 검색이면 정렬값 중 거리(km)를 응답에 붙임
  const distIdx = (request.sort as object[]).findIndex((s) => '_geo_distance' in s);

  const buckets = (res.aggregations?.complexes as estypes.AggregationsStringTermsAggregate | undefined)?.buckets;
  const complexes = (Array.isArray(buckets) ? buckets : []).map((b) => {
    const latest = (b.latest as estypes.AggregationsTopHitsAggregate).hits.hits[0]?._source as TradeDoc;
    return { ...latest, count: b.doc_count };
  });

  return {
    took: res.took, // ES 내부 처리시간(ms) — 성능 비교 지표로 사용
    total,
    page: parsed.data.page,
    maxScore: res.hits.max_score ?? null, // 점수 막대 기준
    complexes, // 지도용: 단지별 거래 수 + 최근 거래
    items: res.hits.hits.map((h) => ({
      id: h._id,
      score: h._score,
      ...(distIdx >= 0 && { distanceKm: Math.round(Number(h.sort?.[distIdx]) * 1000) / 1000 }),
      ...(h.highlight && { highlight: h.highlight }),
      ...h._source,
    })),
  };
});

app.get('/autocomplete', async (req, reply) => {
  const parsed = AutocompleteParamsSchema.safeParse(req.query);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'invalid_params', issues: parsed.error.issues });
  }

  const res = await es.search<TradeDoc>({ index: config.ES_ALIAS, ...buildAutocompleteRequest(parsed.data) });
  return {
    took: res.took,
    items: res.hits.hits.map((h) => {
      const { dealDate, ...complex } = h._source!;
      return { ...complex, lastDealDate: dealDate };
    }),
  };
});

// ---------- 검색 과정 보여주기 ----------
const QSchema = z.object({ q: z.string().trim().min(1).max(100) });

/** 검색어가 어떻게 쪼개져 매칭되는지: 형태소(+동의어) / n-gram */
app.get('/analyze', async (req, reply) => {
  const parsed = QSchema.safeParse(req.query);
  if (!parsed.success) return reply.code(400).send({ error: 'invalid_params', issues: parsed.error.issues });
  const analyze = (analyzer: string) => es.indices.analyze({ index: config.ES_ALIAS, analyzer, text: parsed.data.q });
  const [morph, ngram] = await Promise.all([analyze('ko_search'), analyze('ko_ngram')]);
  return {
    morphemes: (morph.tokens ?? []).map((t) => ({ token: t.token, synonym: t.type === 'SYNONYM', position: t.position })),
    ngrams: [...new Set((ngram.tokens ?? []).map((t) => t.token))],
  };
});

/** 거래 하나가 이 검색어로 몇 점인지, 왜 그런지 (ES _explain 요약) */
app.get('/explain', async (req, reply) => {
  const parsed = QSchema.extend({ id: z.string().regex(/^[0-9a-f]{40}$/) }).safeParse(req.query);
  if (!parsed.success) return reply.code(400).send({ error: 'invalid_params', issues: parsed.error.issues });
  const res = await es.explain({ index: config.ES_ALIAS, id: parsed.data.id, query: textQuery(parsed.data.q) });
  return summarizeExplanation(res.explanation!);
});

app.listen({ port: config.PORT, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
