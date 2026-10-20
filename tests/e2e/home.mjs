// 메인 화면 ↔ 지도 화면 이동 흐름
import { BASE_URL, openBrowser, wait } from './lib.mjs';

const { page, check, popup, finish } = await openBrowser();
const view = () => page.evaluate(() => ($('homeView').hidden ? 'search' : 'home'));

await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle0' });
await wait(300);
check('접속 시 메인 화면', (await view()) === 'home');
check(
  '메인: 카드 4개·피드·순위',
  await page.evaluate(
    () =>
      $('homeCards').children.length === 4 &&
      $('feed').querySelectorAll('.item').length > 0 &&
      $('topTrades').children.length === 5 &&
      $('busiest').children.length === 5,
  ),
);

// 피드 거래 클릭 → 지도 화면 + 그 단지 + 정보창
const feedName = await page.$eval('#feed .item', (el) => el.dataset.name);
await page.click('#feed .item');
await wait(1800);
check('피드 클릭 → 지도 화면', (await view()) === 'search', page.url());
check('피드 클릭 → 그 단지 정보창', (await popup()) === feedName, `${feedName} / ${await popup()}`);

await page.goBack();
await wait(800);
check('뒤로가기 → 메인', (await view()) === 'home', page.url());

const topName = await page.$eval('#topTrades button', (el) => el.dataset.name);
await page.click('#topTrades button');
await wait(1800);
check('최고가 클릭 → 그 단지 정보창', (await popup()) === topName, `${topName} / ${await popup()}`);

// 로고 → 메인, 메인에서 검색 (이전 단지명이 검색어에 남지 않아야 함)
await page.click('#homeLink');
await wait(800);
check('로고 → 메인', (await view()) === 'home');
await page.type('#q', '래미안');
await page.keyboard.press('Escape');
await page.keyboard.press('Enter');
await wait(1500);
check(
  '메인에서 검색 → 지도 화면 결과 (검색어 그대로)',
  (await view()) === 'search' &&
    (await page.$$('.item')).length > 0 &&
    new URL(page.url()).searchParams.get('q') === '래미안',
  page.url(),
);
check('검색 시 지도 크기 정상', await page.evaluate(() => map.getSize().x > 500));

await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle0' });
await page.click('#openMap');
await wait(1500);
check('지도에서 전체 보기 → 지도 화면', (await view()) === 'search' && page.url().includes('view=map'));
await page.reload({ waitUntil: 'networkidle0' });
check('새로고침해도 지도 화면 유지', (await view()) === 'search');

await finish();
