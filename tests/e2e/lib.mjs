/**
 * 실제 크롬으로 화면을 클릭해 보는 E2E 공통 준비. 서버가 떠 있어야 한다.
 *
 *   npm run dev            # 다른 터미널
 *   npm run test:e2e
 *
 * BASE_URL(기본 http://localhost:3100), CHROME_PATH(기본: OS별 크롬 설치 경로)로 바꿀 수 있다.
 */
import puppeteer from 'puppeteer-core';

export const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3100';

const CHROME_PATH =
  process.env.CHROME_PATH ??
  {
    win32: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  }[process.platform] ??
  '/usr/bin/google-chrome';

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function openBrowser() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    defaultViewport: { width: 1440, height: 1000 },
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));

  let fails = 0;
  const check = (label, ok, extra = '') => {
    console.log(ok ? 'PASS' : 'FAIL', label, extra);
    if (!ok) fails++;
  };
  /** 열린 지도 정보창의 첫 줄(단지명) */
  const popup = () =>
    page.evaluate(() => document.querySelector('.leaflet-popup-content')?.innerText.split('\n')[0] ?? null);

  const finish = async () => {
    check('콘솔 에러 없음', errors.length === 0, errors.join(' | '));
    await browser.close();
    process.exitCode = fails ? 1 : 0;
  };

  return { page, check, popup, finish };
}
