// Přijme poptávku s již nahranými fotkami: ověří kontakt, limity a skutečný obsah fotek,
// uloží poptávku do soukromého úložiště a vrátí podepsané odkazy pro e-mailovou notifikaci.
import { del, get, put } from '@vercel/blob';
import {
  ALLOWED_TYPES, LEAD_ID_RE, LIMITS, MAX_FILES, MAX_FILE_BYTES,
  cleanText, clientIp, detectImageType, json, looksLikeBot, normalizeEmail, normalizePhone,
  readJson, sameOrigin, signPath, withinLimits,
} from './_lib.js';

const STYLES = ['Ateliér', 'Interiér', 'Ulice', 'Terasa', 'Příroda', 'Nechám na vás'];
const MODELS = ['Žena', 'Muž', 'Dítě', 'Nechám na vás'];
const LANGS = ['cs', 'en', 'sk', 'de', 'zh-Hans'];
const LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Načte metadata a prvních pár bajtů souboru (pro kontrolu skutečného typu)
async function inspect(pathname) {
  const result = await get(pathname, { access: 'private', useCache: false }).catch(() => null);
  if (!result?.stream) return null;
  const reader = result.stream.getReader();
  const { value } = await reader.read();
  await reader.cancel();
  return { size: result.blob.size, contentType: result.blob.contentType, bytes: value ? value.slice(0, 16) : new Uint8Array() };
}

export async function POST(request) {
  if (!sameOrigin(request)) return json(403, { error: 'Nepovolený původ požadavku.' });

  let body;
  try {
    body = await readJson(request, 8192);
  } catch {
    return json(400, { error: 'Neplatný požadavek.' });
  }

  if (looksLikeBot(body)) return json(400, { error: 'Formulář se nepodařilo ověřit, zkuste to prosím znovu.' });

  const email = normalizeEmail(body.email);
  const phone = normalizePhone(body.phone);
  if (!email) return json(400, { error: 'Zadejte prosím platný e-mail.' });
  if (!phone) return json(400, { error: 'Zadejte prosím platné telefonní číslo.' });

  const leadId = String(body.leadId || '');
  const files = Array.isArray(body.files) ? body.files : [];
  if (!LEAD_ID_RE.test(leadId) || files.length < 1 || files.length > MAX_FILES) {
    return json(400, { error: 'Nahrajte prosím 1 až 3 fotky produktu.' });
  }
  // Fotky musí patřit k této poptávce (cesta generovaná pro tento leadId)
  const prefix = `uploads/${leadId}/`;
  const pathRe = /^uploads\/[0-9a-f-]{36}\/[1-3]-[A-Za-z0-9]+\.(jpg|png|webp)$/;
  if (!files.every((p) => typeof p === 'string' && p.startsWith(prefix) && pathRe.test(p)) || new Set(files).size !== files.length) {
    return json(400, { error: 'Neplatné fotky.' });
  }

  try {
    const ok = await withinLimits([
      [LIMITS.leadPerMinute, clientIp(request)],
      [LIMITS.leadPerDay, clientIp(request)],
    ]);
    if (!ok) return json(429, { error: 'Poptávku jste už odeslali. Další můžete poslat za chvíli.' });

    // Ověření, že fotky existují, mají povolenou velikost a jsou to skutečně obrázky
    for (const pathname of files) {
      const meta = await inspect(pathname);
      if (!meta) return json(400, { error: 'Některá fotka se nenahrála, zkuste to prosím znovu.' });
      const realType = detectImageType(meta.bytes);
      if (meta.size > MAX_FILE_BYTES || !ALLOWED_TYPES.includes(meta.contentType) || !realType) {
        await del(pathname).catch(() => {});
        return json(400, { error: 'Některý soubor není platná fotka (JPG, PNG nebo WebP do 5 MB).' });
      }
    }

    const lead = {
      id: leadId,
      createdAt: new Date().toISOString(),
      email,
      phone,
      name: cleanText(body.name, 100),
      eshop: cleanText(body.eshop, 200),
      style: STYLES.includes(body.style) ? body.style : 'Nechám na vás',
      model: MODELS.includes(body.model) ? body.model : 'Nechám na vás',
      note: cleanText(body.note, 2000),
      lang: LANGS.includes(body.lang) ? body.lang : 'cs',
      files,
    };
    const day = lead.createdAt.slice(0, 10);
    await put(`leads/${day}/${leadId}.json`, JSON.stringify(lead, null, 2), {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: true,
    });

    const expiresAt = Date.now() + LINK_TTL_MS;
    const origin = new URL(request.url).origin;
    const links = files.map((p) =>
      `${origin}/api/fotka?p=${encodeURIComponent(p)}&e=${expiresAt}&s=${signPath(p, expiresAt)}`);

    return json(200, { ok: true, links });
  } catch (error) {
    console.error('lead error', error);
    return json(503, { error: 'Odeslání je dočasně nedostupné. Napište nám prosím na info@bezmodelky.cz.' });
  }
}
