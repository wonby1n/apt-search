import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  MOLIT_SERVICE_KEY: z.string().default(''),
  ES_NODE: z.string().url().default('http://localhost:9200'),
  ES_ALIAS: z.string().min(1).default('apt-trades'),
  PORT: z.coerce.number().int().positive().default(3000),
});

export const config = EnvSchema.parse(process.env);
export type Config = typeof config;
