# 🏢 apt-search — 아파트 실거래가 검색 서비스

국토교통부 아파트 매매 실거래가 공공데이터를 Elasticsearch로 색인하고,
한국어 형태소 분석·자동완성·지오 검색·하이브리드 검색으로 **"원하는 거래를 바로 찾는"** 검색 서비스.

**Stack** · TypeScript (Node 22) · Elasticsearch 9.4 + Nori · Kibana · Fastify · Zod · Vitest

---

## 빠른 시작

```bash
# 0) 공공데이터포털에서 '국토교통부_아파트 매매 실거래가 상세 자료' 활용신청 (자동승인)
cp .env.example .env          # MOLIT_SERVICE_KEY에 Decoding 키 입력
npm install

# 1) ES(+nori) & Kibana 실행
npm run es:up                 # http://localhost:9200 , http://localhost:5601

# 2) 원본 수집 → data/raw/{시군구코드}/{YYYYMM}.ndjson
npm run collect -- --regions seoul --from 202401 --to 202609

# 3) 새 버전 인덱스에 색인 → alias 교체
npm run index

# 4) 검색 API
npm run dev
curl "localhost:3000/search?q=래미안&sggCd=11650&minPrice=200000"
```

`--regions`는 `seoul`, `busan`, `seoul,busan`, `11680,11650`(시군구코드)처럼 지정합니다.

---

## 아키텍처

```
data.go.kr API ──collect──▶ data/raw/*.ndjson ──index──▶ apt-trades-YYYYMMDD-hhmmss
   (XML)          재시도·이어받기   (원본 보관)     변환·bulk       ▲
                                                          alias: apt-trades ◀── Fastify /search
```

## 설계 포인트

| 결정 | 이유 |
|---|---|
| **수집(raw)과 색인 분리** | 매핑·변환을 바꿔도 API 재호출 없이 재색인. 개발계정 일일 10,000건 트래픽 보호 |
| **(지역, 월) 단위 이어받기** | 중간에 끊겨도 재실행하면 남은 것만 수집 |
| **`--refresh-recent N`** | 실거래 신고기한이 계약 후 30일이고 해제 신고도 나중에 들어와서 최근 월 데이터는 계속 바뀜 |
| **결정적 `_id` (SHA-1)** | 같은 거래를 다시 넣어도 중복이 생기지 않음 (멱등) |
| **버전 인덱스 + alias 교체** | 재색인 중에도 검색 무중단, 문제 생기면 alias만 되돌리면 롤백 |
| **bulk 중 `refresh_interval: -1`** | 색인 중 세그먼트 생성 비용 절감 → 끝나고 `1s`로 복구 |
| **shard 1 / replica 0** | 수백만 건 ≈ 수 GB → 샤드 1개로 충분. 단일 노드라 replica는 할당 불가 |
| **`dynamic: strict`** | 오타 필드가 조용히 매핑되는 것 방지 |
| **동의어는 search analyzer에만 (`updateable`)** | 동의어 수정 시 재색인 없이 `_reload_search_analyzers` |
| **인증키·트래픽 초과는 즉시 중단** | 재시도해도 실패하는 에러는 호출만 낭비 |

### 도메인 메모
- `dealAmount` 단위는 **만원**, `area`는 **전용면적(㎡)**
- `pricePerPyeong`은 **전용면적 기준** 평당가. 시중 시세(공급면적 기준)보다 높게 나옴. 공급면적은 이 API에 없음
- `cdealType = "O"`는 **해제(취소)된 거래**. 기본 검색에서 제외하고 `includeCanceled=true`일 때만 포함

---

## 검색 API (1주차)

`GET /search`

| 파라미터 | 설명 |
|---|---|
| `q` | 단지명·동·도로명·주소 (형태소 분석) |
| `sggCd` | 시군구코드 5자리 |
| `minPrice` / `maxPrice` | 거래금액 (만원) |
| `minArea` / `maxArea` | 전용면적 (㎡) |
| `from` / `to` | 계약일 `yyyy-MM-dd` |
| `includeCanceled` | 해제 거래 포함 (`true`/`false`) |
| `page` / `size` | 페이지 (size 최대 50) |

필드 가중치: `aptName^4 > umdName^2 > roadName^1.5 > address`

---

## 로드맵

- [x] **1주차** · ES+Nori 환경, 매핑, 수집·색인 파이프라인, 기본 검색
- [ ] **2주차** · 사용자 사전/동의어 튜닝, 단지명 자동완성, 지오코딩 + `geo_distance`
- [ ] **3주차** · Aggregation 대시보드(동별 평당가, 월별 추이), 검색 품질 평가(nDCG@10)
- [ ] **4주차** · 하이브리드 검색(BM25 + kNN, RRF), MySQL `LIKE` 대비 성능 비교

## 트러블슈팅 기록

> 겪은 문제 → 원인 → 해결 → 결과 수치 순서로 기록

- 예정: "퍼스티지"로 검색하면 "래미안퍼스티지"가 안 잡힘 → `decompound_mode` / 사용자 사전
- 예정: 자동완성에서 "퍼스"처럼 단어 중간부터 입력하면 매칭 안 됨 → `search_as_you_type` 한계

## 테스트

```bash
npm test         # XML 파싱, 변환, 쿼리 빌더, 매핑-쿼리 필드 정합성
npm run typecheck
```
