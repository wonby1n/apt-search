import Fastify from 'fastify';
import { config } from './config.js';
import { es } from './es/client.js';
import { buildSearchRequest, SearchParamsSchema } from './search/query.js';
import type { TradeDoc } from './ingest/transform.js';

const app = Fastify({ logger: true });

app.get('/health', async () => {
  const health = await es.cluster.health();
  return { es: health.status };
});

app.get('/search', async (req, reply) => {
  const parsed = SearchParamsSchema.safeParse(req.query);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'invalid_params', issues: parsed.error.issues });
  }

  const res = await es.search<TradeDoc>({ index: config.ES_ALIAS, ...buildSearchRequest(parsed.data) });
  const total = typeof res.hits.total === 'number' ? res.hits.total : (res.hits.total?.value ?? 0);

  return {
    took: res.took, // ES 내부 처리시간(ms) — 성능 비교 지표로 사용
    total,
    page: parsed.data.page,
    items: res.hits.hits.map((h) => ({ id: h._id, score: h._score, ...h._source })),
  };
});

app.listen({ port: config.PORT, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
