import { join } from 'node:path';
import { openAppendWriter, readNdjson } from './ndjson.js';

/**
 * 거래를 처음 본 날짜. API에 "신고일"이 없어서, 매일 갱신 때 직전 파일과 비교해 새로 나타난 거래를 기록
 * → "어제 새로 공개된 거래"를 보여줄 수 있음 (계약일 기준 "어제 거래"는 신고 지연으로 거의 0건)
 * 최초 일괄 수집분은 기록하지 않음 (전부 "오늘 처음 봄"이 되어 의미 없음)
 */
export const FIRST_SEEN_FILE = join(process.cwd(), 'data', 'first-seen.ndjson');

export interface FirstSeenEntry {
  id: string;
  date: string; // yyyy-MM-dd
}

export async function loadFirstSeen(file = FIRST_SEEN_FILE): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for await (const e of readNdjson<FirstSeenEntry>(file)) {
    if (!map.has(e.id)) map.set(e.id, e.date); // 가장 먼저 본 날짜 유지
  }
  return map;
}

export const openFirstSeenWriter = (file = FIRST_SEEN_FILE) => openAppendWriter<FirstSeenEntry>(file);

/** 이번에 받은 거래 중 이전 파일에 없던 것 */
export function newIds(previous: Iterable<string>, current: Iterable<string>): string[] {
  const prev = new Set(previous);
  return [...new Set(current)].filter((id) => !prev.has(id));
}

/** 로컬 시간 기준 yyyy-MM-dd */
export function localDate(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
