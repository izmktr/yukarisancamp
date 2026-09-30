// ローカルの chara/charaindex.json と画像を Supabase (characters テーブル / chara-images バケット) へ移行する。
// 何度実行しても同じ結果になる。使い方: npm run migrate-chara（確認だけなら npm run migrate-chara:dry-run）
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import {
  computeCharaImageKey,
  insertCharacter,
  listCharacters,
  normalizeCharacterName,
  setCharacterImageKey,
  uploadCharaImage
} from '../services/characterSupabase';

const CHARA_DIR = path.resolve(__dirname, '../../chara');
const CHARA_INDEX_PATH = path.join(CHARA_DIR, 'charaindex.json');
const UPDATED_BY = 'migrate-chara';

type CharaIndexEntry = {
  fileName: string;
  name: string;
};

function loadCharaIndex(): CharaIndexEntry[] {
  const parsed: unknown = JSON.parse(fs.readFileSync(CHARA_INDEX_PATH, 'utf-8'));
  if (!Array.isArray(parsed)) {
    throw new Error('charaindex.json is not an array');
  }
  return parsed.filter((entry): entry is CharaIndexEntry => {
    return entry
      && typeof entry.fileName === 'string'
      && typeof entry.name === 'string';
  });
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const entries = loadCharaIndex();
  const existingByName = new Map((await listCharacters()).map((row) => [row.name, row]));

  const inserted: string[] = [];
  const imageUpdated: string[] = [];
  const unchanged: string[] = [];
  const missingImage: string[] = [];
  const duplicated: string[] = [];
  const failed: string[] = [];
  const seenNames = new Set<string>();

  for (const entry of entries) {
    const name = normalizeCharacterName(entry.name);
    if (!name) {
      continue;
    }
    if (seenNames.has(name)) {
      duplicated.push(`${name} (${entry.fileName})`);
      continue;
    }
    seenNames.add(name);

    const imagePath = path.join(CHARA_DIR, path.basename(entry.fileName));
    if (!fs.existsSync(imagePath)) {
      missingImage.push(`${name} (${entry.fileName})`);
      continue;
    }

    const image = fs.readFileSync(imagePath);
    const imageKey = computeCharaImageKey(image);
    const existing = existingByName.get(name);
    if (existing && existing.image_key === imageKey) {
      unchanged.push(name);
      continue;
    }

    if (dryRun) {
      (existing ? imageUpdated : inserted).push(name);
      continue;
    }

    try {
      await uploadCharaImage(image);
      if (existing) {
        await setCharacterImageKey(name, imageKey, UPDATED_BY);
        imageUpdated.push(name);
      } else {
        await insertCharacter(name, imageKey, UPDATED_BY);
        inserted.push(name);
      }
    } catch (error) {
      failed.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const indexedFileNames = new Set(entries.map((entry) => path.basename(entry.fileName)));
  const unindexedImages = fs.readdirSync(CHARA_DIR)
    .filter((fileName) => fileName.toLowerCase().endsWith('.png'))
    .filter((fileName) => !indexedFileNames.has(fileName));

  const printList = (title: string, items: string[]) => {
    console.log(`${title}: ${items.length}件`);
    items.forEach((item) => console.log(`  - ${item}`));
  };

  console.log(dryRun ? '[dry-run] 書き込みは行っていません' : '移行が完了しました');
  console.log(`新規登録: ${inserted.length}件`);
  console.log(`画像を更新: ${imageUpdated.length}件`);
  console.log(`変更なし: ${unchanged.length}件`);
  printList('画像ファイルが無い名前（未登録）', missingImage);
  printList('charaindex.json 内で重複した名前（2件目以降は未登録）', duplicated);
  printList('charaindex.json に載っていない画像（未登録）', unindexedImages);
  printList('失敗', failed);

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
