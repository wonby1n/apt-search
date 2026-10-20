import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { summarizeExplanation } from '../src/search/explain.js';

// "레미안 퍼스티지" → 래미안퍼스티지 문서의 실제 _explain 결과
const fixture = JSON.parse(readFileSync(new URL('./fixtures/explain.json', import.meta.url), 'utf8'));

describe('summarizeExplanation', () => {
  const s = summarizeExplanation(fixture);

  it('best_fields: 가장 높은 필드(단지명)가 최종 점수', () => {
    expect(s.matched).toBe(true);
    expect(s.fields[0]).toMatchObject({ field: 'aptName', chosen: true });
    expect(s.fields[0]!.score).toBeCloseTo(s.score);
    expect(s.fields.slice(1).every((f) => !f.chosen)).toBe(true);
  });

  it('동의어는 한 항목에 묶이고, 드문 단어의 idf가 더 크다', () => {
    const [raemian, prestige] = s.fields[0]!.terms;
    expect(raemian!.terms).toEqual(['래미안', '레미안']);
    expect(prestige!.terms).toEqual(['퍼스티지']);
    expect(prestige!.docFreq).toBeLessThan(raemian!.docFreq);
    expect(prestige!.idf).toBeGreaterThan(raemian!.idf);
    // score = boost × idf × tf
    expect(prestige!.boost * prestige!.idf * prestige!.tf).toBeCloseTo(prestige!.score, 2);
  });

  it('매칭 안 되면 필드 없음', () => {
    expect(summarizeExplanation({ value: 0, description: 'No matching clause', details: [] })).toEqual({
      score: 0, matched: false, fields: [],
    });
  });
});
