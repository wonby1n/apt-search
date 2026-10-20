// 목록 클릭 → 지도 이동 + 정보창
import { BASE_URL, openBrowser, wait } from './lib.mjs';

const { page, check, popup, finish } = await openBrowser();

await page.goto(`${BASE_URL}/?view=map`, { waitUntil: 'networkidle0' });
await wait(500);

// 첫 항목은 집계 300개 밖의 작은 단지일 수 있음
for (const idx of [1, 2, 6, 11]) {
  const name = await page.$eval(`.item:nth-child(${idx}) .name`, (el) =>
    el.innerText.replace(/신규|해제|\d+(\.\d+)?k?m$/g, '').trim(),
  );
  await page.click(`.item:nth-child(${idx}) .name`);
  await wait(1200);
  const p = await popup();
  check(`지도 화면 목록 ${idx}번 클릭 → 정보창`, p === name, `(${name} / popup=${p})`);
}

// 검색 결과에서 클릭 (확대 변경 후에도 정보창 유지)
await page.goto(`${BASE_URL}/?q=${encodeURIComponent('래미안')}`, { waitUntil: 'networkidle0' });
for (const idx of [1, 6]) {
  const name = await page.$eval(`.item:nth-child(${idx}) .name`, (el) => el.innerText.trim());
  await page.click(`.item:nth-child(${idx}) .name`);
  await wait(1200);
  check(`검색 목록 ${idx}번 클릭 → 정보창`, (await popup()) === name, `(${name})`);
}

await finish();
