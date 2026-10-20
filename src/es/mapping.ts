import type { estypes } from '@elastic/elasticsearch';

/**
 * 인덱스 설정.
 * - 단일 노드 개발 환경이라 replica 0 (replica를 1로 두면 할당 불가로 클러스터가 yellow)
 * - 데이터 수십만~수백만 건 수준이라 primary shard 1개로 충분 (샤드당 권장 10~50GB)
 */
export const indexSettings: estypes.IndicesIndexSettings = {
  number_of_shards: 1,
  number_of_replicas: 0,
  analysis: {
    tokenizer: {
      ko_tokenizer: {
        type: 'nori_tokenizer',
        // mixed: "래미안퍼스티지" → 래미안퍼스티지 + 래미안 + 퍼스티지 (원형과 분해형 모두 색인)
        decompound_mode: 'mixed',
        discard_punctuation: true,
        user_dictionary: 'analysis/userdict_ko.txt',
      },
      // 검색 쪽은 분해형만. mixed는 원형·분해형이 겹친 토큰 그래프를 내는데 synonym_graph가 그래프 입력을 처리 못 해
      // "래미안퍼스티지" 쿼리가 빈 Synonym()으로 바뀌어 0건이 됨 (색인 쪽 mixed와 분해형이 겹치므로 매칭은 그대로)
      ko_tokenizer_search: {
        type: 'nori_tokenizer',
        decompound_mode: 'discard',
        discard_punctuation: true,
        user_dictionary: 'analysis/userdict_ko.txt',
      },
      // 사전에 없는 단지명도 부분 일치되도록 2~3글자 조각으로 색인 ("퍼스티지" ⊂ "래미안퍼스티지")
      ngram_2_3: {
        type: 'ngram',
        min_gram: 2,
        max_gram: 3,
        token_chars: ['letter', 'digit'],
      },
    },
    filter: {
      ko_pos: {
        type: 'nori_part_of_speech', // 조사·어미 등 제거 (기본 stoptags)
      },
      ko_synonym: {
        type: 'synonym_graph',
        synonyms_path: 'analysis/synonyms.txt',
        updateable: true, // search analyzer 전용 → 재색인 없이 동의어 리로드 가능
      },
    },
    analyzer: {
      ko_index: {
        type: 'custom',
        tokenizer: 'ko_tokenizer',
        filter: ['lowercase', 'ko_pos'],
      },
      ko_search: {
        type: 'custom',
        tokenizer: 'ko_tokenizer_search',
        filter: ['lowercase', 'ko_pos', 'ko_synonym'],
      },
      ko_ngram: {
        type: 'custom',
        tokenizer: 'ngram_2_3',
        filter: ['lowercase'],
      },
    },
    normalizer: {
      lc: { type: 'custom', filter: ['lowercase'] },
    },
  },
};

const koText = (extra: Omit<estypes.MappingTextProperty, 'type'> = {}): estypes.MappingTextProperty => ({
  analyzer: 'ko_index',
  search_analyzer: 'ko_search',
  ...extra,
  type: 'text',
});

export const indexMappings: estypes.MappingTypeMapping = {
  dynamic: 'strict', // 오타 필드가 조용히 생기지 않도록
  properties: {
    aptName: koText({
      fields: {
        keyword: { type: 'keyword', ignore_above: 256 },
        // 단어 중간 일치 (형태소 분석이 못 쪼개는 미등록 단지명, 타이핑 중인 "퍼스티") → 검색 fallback + 자동완성
        // search_as_you_type은 standard 분석기라 "래미안퍼스티지"가 한 토큰 → "퍼스" 입력을 못 잡아서 쓰지 않음
        ngram: { type: 'text', analyzer: 'ko_ngram' },
      },
    }),
    aptSeq: { type: 'keyword' },
    // 단지 식별자. aptSeq가 없으면 (시군구·법정동·지번·단지명)으로 대체 → 자동완성 collapse 기준
    complexId: { type: 'keyword' },
    aptDong: { type: 'keyword' },
    sido: { type: 'keyword' },
    sggCd: { type: 'keyword' },
    sggName: { type: 'keyword' },
    umdName: { type: 'keyword', fields: { text: koText() } },
    jibun: { type: 'keyword' },
    roadName: { type: 'keyword', fields: { text: koText() } },
    address: koText(),
    buildYear: { type: 'short' },
    dealDate: { type: 'date', format: 'yyyy-MM-dd' },
    dealAmount: { type: 'long' },
    area: { type: 'scaled_float', scaling_factor: 100 },
    pricePerPyeong: { type: 'integer' },
    floor: { type: 'short' },
    dealingType: { type: 'keyword' },
    buyerType: { type: 'keyword' },
    sellerType: { type: 'keyword' },
    canceled: { type: 'boolean' },
    cancelDate: { type: 'date', format: 'yyyy-MM-dd' },
    location: { type: 'geo_point' }, // npm run geocode
    firstSeenDate: { type: 'date', format: 'yyyy-MM-dd' }, // 매일 갱신에서 처음 발견한 날
  },
};
