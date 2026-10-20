import { Client } from '@elastic/elasticsearch';
import { config } from '../config.js';

export const es = new Client({ node: config.ES_NODE });
