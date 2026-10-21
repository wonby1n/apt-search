import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Client } from '@elastic/elasticsearch';
import { collectedRegionCodes, collectMonths } from './collector.js';
import { localDate } from './first-seen.js';
import { geocodeComplexes } from './geocoder.js';
import { reindex } from './indexer.js';
import { recentMonths } from './months.js';
import { findRegion, type Region } from './regions.js';

/**
 * 매일 갱신: 최근 2개월 재수집 → 새 단지 지오코딩 → 재색인
 *
 * 왜 "어제치"가 아니라 2개월인가: API는 계약년월(DEAL_YMD)로만 조회되고 신고일 필터가 없음.
 * 신고기한이 계약 후 30일이라 어제 신고된 거래는 이번 달 또는 지난달 계약 → 두 달을 통째로 다시 받아 직전 파일과 비교
 */
export const REFRESH_MONTHS = 2;
export const REFRESH_STATUS_FILE = join(process.cwd(), 'data', 'refresh-status.json');

export interface RefreshStatus {
  startedAt: string;
  finishedAt: string | null;
  ok: boolean | null; // null = 진행 중
  months: string[];
  regions: number;
  newTrades: number;
  newComplexes: number;
  error?: string;
}

export interface RefreshDeps {
  es: Client;
  alias: string;
  molitKey: string;
  kakaoKey: string;
  log?: (msg: string) => void;
}

let running: Promise<RefreshStatus> | null = null;

/** 동시에 두 번 돌지 않게 (스케줄 + 수동 실행이 겹쳐도 하나만) */
export function runRefresh(deps: RefreshDeps): Promise<RefreshStatus> {
  running ??= doRefresh(deps).finally(() => (running = null));
  return running;
}

async function doRefresh({ es, alias, molitKey, kakaoKey, log = console.log }: RefreshDeps): Promise<RefreshStatus> {
  const months = recentMonths(REFRESH_MONTHS);
  // 이미 수집해 둔 지역만 최신으로 유지
  const regions = (await collectedRegionCodes()).map(findRegion).filter((r): r is Region => !!r);
  const status: RefreshStatus = {
    startedAt: new Date().toISOString(), finishedAt: null, ok: null,
    months, regions: regions.length, newTrades: 0, newComplexes: 0,
  };
  await saveStatus(status);
  log(`[갱신] 시작: ${regions.length}개 지역 × ${months.join(', ')}`);

  try {
    if (!regions.length) throw new Error('data/raw에 수집된 지역이 없습니다 (먼저 npm run collect)');
    const collected = await collectMonths({
      serviceKey: molitKey, regions, months,
      refresh: new Set(months),
      firstSeenDate: localDate(),
      log: (m) => log(`[갱신] ${m}`),
    });
    if (collected.aborted) throw collected.aborted;
    status.newTrades = collected.newTrades;
    // 일부 (지역, 월) 실패는 다음 갱신 때 다시 받으므로 계속 진행
    if (collected.failed.length) log(`[갱신] 수집 실패 ${collected.failed.length}건: ${collected.failed.join(', ')}`);

    if (kakaoKey) {
      const geo = await geocodeComplexes({ apiKey: kakaoKey, log: (m) => log(`[갱신] ${m}`) });
      status.newComplexes = geo.found + geo.missed;
    }

    await reindex(es, alias, { keepPrevious: 1, log: (m) => log(`[갱신] ${m}`) });
    status.ok = true;
    log(`[갱신] 완료: 신규 공개 ${status.newTrades}건, 새 단지 ${status.newComplexes}개`);
  } catch (err) {
    status.ok = false;
    status.error = (err as Error).message;
    log(`[갱신] 실패: ${status.error}`);
  }
  status.finishedAt = new Date().toISOString();
  await saveStatus(status);
  return status;
}

const saveStatus = (s: RefreshStatus) => writeFile(REFRESH_STATUS_FILE, JSON.stringify(s, null, 2));

export async function loadRefreshStatus(): Promise<RefreshStatus | null> {
  if (!existsSync(REFRESH_STATUS_FILE)) return null;
  return JSON.parse(await readFile(REFRESH_STATUS_FILE, 'utf8')) as RefreshStatus;
}

/** 다음 hh:mm (로컬 시간). 이미 지났으면 내일 */
export function nextRunAt(hhmm: string, now = new Date()): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
}

/** 오늘 hh:mm이 지났는데 그 이후로 성공한 갱신이 없으면 true (서버가 꺼져 있었거나 PC가 절전이었던 날) */
export function isRefreshDue(hhmm: string, last: RefreshStatus | null, now = new Date()): boolean {
  const [h, m] = hhmm.split(':').map(Number);
  const todayAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
  if (now < todayAt) return false;
  return !last?.ok || new Date(last.startedAt) < todayAt;
}

/**
 * 매일 hh:mm에 갱신. 반환값으로 다음 실행 시각 조회
 * 서버를 그 시각 이후에 켰고 오늘 갱신이 아직이면 바로 한 번 따라잡는다.
 * (절전 중 지난 타이머는 깨어날 때 실행되므로 따로 처리하지 않음)
 */
export function scheduleDailyRefresh(hhmm: string, deps: RefreshDeps) {
  let next = nextRunAt(hhmm);
  const arm = () => {
    next = nextRunAt(hhmm);
    // 서버가 오래 떠 있어도 하루 단위로 다시 계산 (setTimeout 최대 약 24.8일 제한도 피함)
    setTimeout(async () => {
      await runRefresh(deps);
      arm();
    }, next.getTime() - Date.now()).unref();
  };
  arm();
  void loadRefreshStatus().then((last) => {
    if (!isRefreshDue(hhmm, last)) return;
    (deps.log ?? console.log)(`[갱신] 오늘 ${hhmm} 갱신이 아직이라 지금 실행`);
    return runRefresh(deps);
  });
  return { nextAt: () => next };
}
