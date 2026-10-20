import { createReadStream, existsSync } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';

/** ndjson 파일을 한 줄씩. 파일이 없으면 빈 결과, 반쯤 쓰인 줄(중단된 쓰기)은 건너뜀 */
export async function* readNdjson<T>(file: string): AsyncGenerator<T> {
  if (!existsSync(file)) return;
  for await (const line of createInterface({ input: createReadStream(file) })) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line) as T;
    } catch {
      continue;
    }
  }
}

/**
 * 이어쓰기 writer. 여러 worker가 appendFile을 동시에 부르면 /mnt/c(WSL drvfs)에서 줄이 서로 덮어써져 깨짐
 * (실측: 7,274줄 중 5,235줄만 남고 1,116줄 손상) → 핸들 하나로 순서대로 씀
 */
export async function openAppendWriter<T>(file: string) {
  await mkdir(dirname(file), { recursive: true });
  const fh = await open(file, 'a');
  let chain: Promise<unknown> = Promise.resolve();
  return {
    append: (entry: T) => (chain = chain.then(() => fh.write(JSON.stringify(entry) + '\n'))),
    close: async () => {
      await chain;
      await fh.close();
    },
  };
}
