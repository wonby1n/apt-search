import type { estypes } from '@elastic/elasticsearch';

/**
 * ES _explain 트리(수십 줄)를 화면용으로 요약: 필드별 점수 → 단어별 BM25 구성요소
 *
 *   score(단어) = boost × idf × tf
 *   idf = log(1 + (N − n + 0.5) / (n + 0.5))   ← 드문 단어일수록 큼 (n: 그 단어가 있는 문서 수)
 *   tf  = freq / (freq + k1 × (1 − b + b × dl / avgdl))   ← 필드가 짧을수록 큼
 *
 * best_fields는 필드별 점수 중 최댓값("max of")만 최종 점수로 씀
 */
export interface TermScore {
  field: string;
  terms: string[]; // 동의어면 여러 개 (래미안/레미안)
  score: number;
  boost: number;
  idf: number;
  docFreq: number; // n
  docCount: number; // N
  tf: number;
  fieldLength: number; // dl
  avgFieldLength: number; // avgdl
}

export interface FieldScore {
  field: string;
  score: number;
  chosen: boolean; // best_fields가 고른 필드
  terms: TermScore[];
}

export interface ScoreExplanation {
  score: number;
  matched: boolean;
  fields: FieldScore[];
}

type Node = estypes.ExplainExplanationDetail;

const child = (n: Node, prefix: string) => n.details?.find((d) => d.description.startsWith(prefix));
const valueOf = (n: Node | undefined, prefix: string) => (n && child(n, prefix)?.value) ?? 0;

function collectWeights(n: Node, out: TermScore[]) {
  const m = n.description.match(/^weight\((.+) in \d+\)/);
  if (!m) {
    for (const d of n.details ?? []) collectWeights(d, out);
    return;
  }
  // "aptName:퍼스티지" 또는 "Synonym(aptName:래미안 aptName:레미안)"
  const pairs = [...m[1]!.matchAll(/([\w.]+):([^\s)]+)/g)];
  const score = child(n, 'score(');
  const idf = score && child(score, 'idf');
  const tf = score && child(score, 'tf');
  out.push({
    field: pairs[0]?.[1] ?? '?',
    terms: pairs.map((p) => p[2]!),
    score: n.value,
    boost: valueOf(score, 'boost'),
    idf: idf?.value ?? 0,
    docFreq: valueOf(idf, 'n,'),
    docCount: valueOf(idf, 'N,'),
    tf: tf?.value ?? 0,
    fieldLength: valueOf(tf, 'dl,'),
    avgFieldLength: valueOf(tf, 'avgdl,'),
  });
}

export function summarizeExplanation(root: Node): ScoreExplanation {
  const matched = root.value > 0;
  // 필드가 하나면 "max of" 없이 바로 sum/weight
  const clauses = root.description.startsWith('max of') ? (root.details ?? []) : [root];
  const fields: FieldScore[] = [];
  for (const c of clauses) {
    if (c.value <= 0) continue;
    const terms: TermScore[] = [];
    collectWeights(c, terms);
    if (terms.length) fields.push({ field: terms[0]!.field, score: c.value, chosen: false, terms });
  }
  fields.sort((a, b) => b.score - a.score);
  if (matched && fields[0]) fields[0].chosen = true;
  return { score: root.value, matched, fields };
}
