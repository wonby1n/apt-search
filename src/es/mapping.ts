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
        tokenizer: 'ko_tokenizer',
        filter: ['lowercase', 'ko_pos', 'ko_synonym'],
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
        // 2주차 자동완성용
        ac: { type: 'search_as_you_type' },
      },
    }),
    aptSeq: { type: 'keyword' },
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
    // 2주차 지오코딩 후 채움
    location: { type: 'geo_point' },
  },
};
