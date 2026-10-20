/** 법정동코드 앞 5자리(시군구) → 이름. API의 LAWD_CD 파라미터로 사용 */
export interface Region {
  lawdCd: string;
  sido: string;
  sgg: string;
}

const SEOUL: Array<[string, string]> = [
  ['11110', '종로구'], ['11140', '중구'], ['11170', '용산구'], ['11200', '성동구'],
  ['11215', '광진구'], ['11230', '동대문구'], ['11260', '중랑구'], ['11290', '성북구'],
  ['11305', '강북구'], ['11320', '도봉구'], ['11350', '노원구'], ['11380', '은평구'],
  ['11410', '서대문구'], ['11440', '마포구'], ['11470', '양천구'], ['11500', '강서구'],
  ['11530', '구로구'], ['11545', '금천구'], ['11560', '영등포구'], ['11590', '동작구'],
  ['11620', '관악구'], ['11650', '서초구'], ['11680', '강남구'], ['11710', '송파구'],
  ['11740', '강동구'],
];

const BUSAN: Array<[string, string]> = [
  ['26110', '중구'], ['26140', '서구'], ['26170', '동구'], ['26200', '영도구'],
  ['26230', '부산진구'], ['26260', '동래구'], ['26290', '남구'], ['26320', '북구'],
  ['26350', '해운대구'], ['26380', '사하구'], ['26410', '금정구'], ['26440', '강서구'],
  ['26470', '연제구'], ['26500', '수영구'], ['26530', '사상구'], ['26710', '기장군'],
];

const toRegions = (sido: string, rows: Array<[string, string]>): Region[] =>
  rows.map(([lawdCd, sgg]) => ({ lawdCd, sido, sgg }));

export const REGION_SETS: Record<string, Region[]> = {
  seoul: toRegions('서울특별시', SEOUL),
  busan: toRegions('부산광역시', BUSAN),
};

export const ALL_REGIONS: Region[] = Object.values(REGION_SETS).flat();

const byCode = new Map(ALL_REGIONS.map((r) => [r.lawdCd, r]));
export const findRegion = (lawdCd: string): Region | undefined => byCode.get(lawdCd);

/** "seoul", "busan", "seoul,busan", "11680,11650" 형태를 Region[]으로 */
export function resolveRegions(spec: string): Region[] {
  const out: Region[] = [];
  for (const token of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const set = REGION_SETS[token];
    if (set) {
      out.push(...set);
      continue;
    }
    const r = findRegion(token);
    if (!r) throw new Error(`알 수 없는 지역: ${token}`);
    out.push(r);
  }
  return [...new Map(out.map((r) => [r.lawdCd, r])).values()];
}
