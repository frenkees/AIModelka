// Sdílené pomocné funkce pro API (soubory začínající "_" nejsou na Vercelu samostatné endpointy).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_FILES = 3;
export const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
export const LEAD_ID_RE = new RegExp(`^${UUID}$`);
// Cesta, kterou klient smí požadovat: uploads/<leadId>/<1-3>.<ext>
export const UPLOAD_PATH_RE = new RegExp(`^uploads/(${UUID})/([1-3])\\.(jpg|png|webp)$`);

export const json = (status, data) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

export const clientIp = (request) =>
  request.headers.get('x-real-ip') ||
  (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
  'unknown';

// Požadavky smí přicházet jen z našeho webu (ochrana proti zneužití z cizích stránek)
export function sameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).host === request.headers.get('host');
  } catch {
    return false;
  }
}

// Načte JSON tělo s pevným limitem velikosti
export async function readJson(request, maxBytes) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > maxBytes) throw new Error('too-large');
  const text = await request.text();
  if (text.length > maxBytes) throw new Error('too-large');
  return JSON.parse(text);
}

// ===== Validace kontaktu =====
export function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(email) ? email : null;
}

export function normalizePhone(value) {
  const phone = String(value || '').replace(/[\s\-().]/g, '');
  return /^\+?[0-9]{9,15}$/.test(phone) ? phone : null;
}

export const cleanText = (value, max) =>
  String(value || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);

// Kontrola proti botům: vyplněná skrytá past nebo příliš rychlé odeslání formuláře
export function looksLikeBot({ hp, t }) {
  if (hp) return true;
  const elapsed = Date.now() - Number(t);
  return !Number.isFinite(elapsed) || elapsed < 3000 || elapsed > 6 * 60 * 60 * 1000;
}

// ===== Rate limiting (Upstash Redis) =====
let redis;
function getRedis() {
  if (redis !== undefined) return redis;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  redis = url && token ? new Redis({ url, token }) : null;
  return redis;
}

const limiters = {};
function limiter(name, tokens, window) {
  const r = getRedis();
  if (!r) return null;
  limiters[name] ??= new Ratelimit({ redis: r, limiter: Ratelimit.slidingWindow(tokens, window), prefix: `bm:${name}` });
  return limiters[name];
}

export const LIMITS = {
  uploadPerMinute: ['upload-min', 3, '1 m'],
  uploadPerDay: ['upload-day', 15, '1 d'],
  uploadGlobalPerDay: ['upload-global', 300, '1 d'],
  leadPerMinute: ['lead-min', 1, '1 m'],
  leadPerDay: ['lead-day', 5, '1 d'],
};

// Vrací true, pokud je požadavek v limitu. Bez nakonfigurovaného Redisu fail-closed.
export async function withinLimits(checks) {
  for (const [[name, tokens, window], key] of checks) {
    const l = limiter(name, tokens, window);
    if (!l) throw new Error('ratelimit-not-configured');
    const { success } = await l.limit(key);
    if (!success) return false;
  }
  return true;
}

// ===== Podepsané odkazy na soukromé fotky (pro e-mailovou notifikaci) =====
const linkSecret = () => process.env.FILE_LINK_SECRET || process.env.BLOB_READ_WRITE_TOKEN || '';

export function signPath(pathname, expiresAt) {
  return createHmac('sha256', linkSecret()).update(`${pathname}:${expiresAt}`).digest('base64url');
}

export function verifySignature(pathname, expiresAt, signature) {
  if (!linkSecret() || !signature || Date.now() > Number(expiresAt)) return false;
  const expected = Buffer.from(signPath(pathname, expiresAt));
  const given = Buffer.from(String(signature));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// ===== Kontrola skutečného obsahu souboru (magic bytes) =====
export function detectImageType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}
