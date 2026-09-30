import crypto from 'crypto';

type SupabaseConfig = {
  url: string;
  secretKey: string;
};

export type CharacterRow = {
  name: string;
  image_key: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
};

export class CharacterConflictError extends Error {}

const CHARACTERS_TABLE = 'characters';
const CHARA_IMAGE_BUCKET = 'chara-images';
const CACHE_RETRY_INTERVAL_MS = 60 * 1000;

function getSupabaseConfig(): SupabaseConfig {
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    throw new Error('Supabase is not configured');
  }
  return { url: url.replace(/\/$/, ''), secretKey };
}

function authHeaders(config: SupabaseConfig): Record<string, string> {
  return {
    apikey: config.secretKey,
    Authorization: `Bearer ${config.secretKey}`
  };
}

async function throwResponseError(response: Response, action: string): Promise<never> {
  const responseText = await response.text();
  if (response.status === 409) {
    throw new CharacterConflictError(`${action} failed: ${responseText}`);
  }
  throw new Error(`${action} failed: ${response.status} ${responseText}`);
}

export function normalizeCharacterName(name: string): string {
  return (name || '').trim();
}

export function getCharaImagePublicUrl(imageKey: string): string {
  const config = getSupabaseConfig();
  return `${config.url}/storage/v1/object/public/${CHARA_IMAGE_BUCKET}/${encodeURIComponent(imageKey)}`;
}

export async function listCharacters(): Promise<CharacterRow[]> {
  const config = getSupabaseConfig();
  const response = await fetch(
    `${config.url}/rest/v1/${CHARACTERS_TABLE}?select=name,image_key,created_at,updated_at,updated_by&order=name.asc`,
    { method: 'GET', headers: authHeaders(config) }
  );
  if (!response.ok) {
    await throwResponseError(response, 'List characters');
  }
  return await response.json() as CharacterRow[];
}

export async function insertCharacter(name: string, imageKey: string | null, updatedBy: string): Promise<void> {
  const config = getSupabaseConfig();
  const response = await fetch(`${config.url}/rest/v1/${CHARACTERS_TABLE}`, {
    method: 'POST',
    headers: {
      ...authHeaders(config),
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify({ name, image_key: imageKey, updated_by: updatedBy })
  });
  if (!response.ok) {
    await throwResponseError(response, 'Insert character');
  }
}

async function patchCharacter(name: string, values: Record<string, unknown>, updatedBy: string): Promise<number> {
  const config = getSupabaseConfig();
  const query = new URLSearchParams({ name: `eq.${name}` });
  const response = await fetch(`${config.url}/rest/v1/${CHARACTERS_TABLE}?${query.toString()}`, {
    method: 'PATCH',
    headers: {
      ...authHeaders(config),
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify({ ...values, updated_at: new Date().toISOString(), updated_by: updatedBy })
  });
  if (!response.ok) {
    await throwResponseError(response, 'Update character');
  }
  const rows = await response.json() as unknown[];
  return rows.length;
}

export async function renameCharacter(oldName: string, newName: string, updatedBy: string): Promise<boolean> {
  return (await patchCharacter(oldName, { name: newName }, updatedBy)) > 0;
}

export async function setCharacterImageKey(name: string, imageKey: string, updatedBy: string): Promise<boolean> {
  return (await patchCharacter(name, { image_key: imageKey }, updatedBy)) > 0;
}

export function computeCharaImageKey(image: Buffer): string {
  return `${crypto.createHash('sha256').update(image).digest('hex')}.png`;
}

export async function uploadCharaImage(image: Buffer): Promise<string> {
  const config = getSupabaseConfig();
  const imageKey = computeCharaImageKey(image);
  const response = await fetch(`${config.url}/storage/v1/object/${CHARA_IMAGE_BUCKET}/${imageKey}`, {
    method: 'POST',
    headers: {
      ...authHeaders(config),
      'Content-Type': 'image/png',
      // キーは画像内容のハッシュなので、同じキーの中身は変わらない
      'Cache-Control': 'public, max-age=31536000, immutable',
      'x-upsert': 'true'
    },
    body: new Uint8Array(image)
  });
  if (!response.ok) {
    await throwResponseError(response, 'Upload character image');
  }
  return imageKey;
}

export async function deleteCharaImageIfUnused(imageKey: string): Promise<void> {
  const characters = await listCharacters();
  if (characters.some((character) => character.image_key === imageKey)) {
    return;
  }
  const config = getSupabaseConfig();
  const response = await fetch(`${config.url}/storage/v1/object/${CHARA_IMAGE_BUCKET}/${imageKey}`, {
    method: 'DELETE',
    headers: authHeaders(config)
  });
  if (!response.ok && response.status !== 404) {
    await throwResponseError(response, 'Delete character image');
  }
}

let characterImageUrlByName = new Map<string, string>();
let cacheLoaded = false;
let lastCacheAttemptAt = 0;
let cacheLoading: Promise<number> | null = null;

export async function refreshCharacterCache(): Promise<number> {
  if (cacheLoading) {
    return await cacheLoading;
  }
  lastCacheAttemptAt = Date.now();
  cacheLoading = (async () => {
    try {
      const characters = await listCharacters();
      characterImageUrlByName = new Map(
        characters
          .filter((character) => character.image_key)
          .map((character) => [character.name, getCharaImagePublicUrl(character.image_key as string)])
      );
      cacheLoaded = true;
      return characters.length;
    } finally {
      cacheLoading = null;
    }
  })();
  return await cacheLoading;
}

function retryCacheLoadIfNeeded(): void {
  if (cacheLoaded || cacheLoading || Date.now() - lastCacheAttemptAt < CACHE_RETRY_INTERVAL_MS) {
    return;
  }
  refreshCharacterCache().catch((error) => {
    console.error('Failed to load character cache:', error);
  });
}

export function resolveCharacterImageUrl(name: string): string | null {
  retryCacheLoadIfNeeded();
  return characterImageUrlByName.get(normalizeCharacterName(name)) || null;
}
