import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  MOLIT_SERVICE_KEY: z.string().default(''),
  KAKAO_REST_API_KEY: z.string().default(''),
  ES_NODE: z.string().url().default('http://localhost:9200'),
  ES_ALIAS: z.string().min(1).default('apt-trades'),
  PORT: z.coerce.number().int().positive().default(3000),
  // 매일 갱신 시각 (로컬 시간). 빈 값이면 끔
  REFRESH_AT: z.union([z.string().regex(/^\d{2}:\d{2}$/), z.literal('')]).default('10:00'),
});

export const config = EnvSchema.parse(process.env);
export type Config = typeof config;
