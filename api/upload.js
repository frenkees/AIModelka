// Přijme jednu fotku k poptávce a uloží ji do soukromého Vercel Blob úložiště.
// Fotka se uloží až po ověření kontaktu, limitů, velikosti a skutečného obsahu souboru.
import { put } from '@vercel/blob';
import {
  LEAD_ID_RE, LIMITS, MAX_FILE_BYTES,
  clientIp, detectImageType, json, looksLikeBot, normalizeEmail, normalizePhone, sameOrigin, withinLimits,
} from './_lib.js';

const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
// Rezerva na pole formuláře kolem samotné fotky
const MAX_BODY_BYTES = MAX_FILE_BYTES + 16 * 1024;

export async function POST(request) {
  if (!sameOrigin(request)) return json(403, { error: 'Nepovolený původ požadavku.' });
  if (!(request.headers.get('content-type') || '').startsWith('multipart/form-data')) {
    return json(400, { error: 'Neplatný požadavek.' });
  }
  const len = Number(request.headers.get('content-length'));
  if (!len || len > MAX_BODY_BYTES) return json(413, { error: 'Fotka je příliš velká.' });

  let form;
  try {
    form = await request.formData();
  } catch {
    return json(400, { error: 'Neplatný požadavek.' });
  }

  if (looksLikeBot({ hp: form.get('hp'), t: form.get('t') })) {
    return json(400, { error: 'Formulář se nepodařilo ověřit, zkuste to prosím znovu.' });
  }
  if (!normalizeEmail(form.get('email'))) return json(400, { error: 'Zadejte prosím platný e-mail.' });
  if (!normalizePhone(form.get('phone'))) return json(400, { error: 'Zadejte prosím platné telefonní číslo.' });

  const leadId = String(form.get('leadId') || '');
  const index = String(form.get('index') || '');
  const photo = form.get('photo');
  if (!LEAD_ID_RE.test(leadId) || !/^[1-3]$/.test(index) || !(photo instanceof Blob)) {
    return json(400, { error: 'Neplatný soubor.' });
  }
  if (photo.size > MAX_FILE_BYTES) return json(413, { error: 'Fotka je příliš velká.' });

  // Typ se určuje podle obsahu souboru, ne podle toho, co tvrdí prohlížeč
  const bytes = new Uint8Array(await photo.arrayBuffer());
  const type = detectImageType(bytes);
  if (!type) return json(400, { error: 'Soubor není platná fotka (JPG, PNG nebo WebP).' });

  try {
    const ip = clientIp(request);
    const ok = await withinLimits([
      [LIMITS.uploadPerMinute, ip],
      [LIMITS.uploadPerDay, ip],
      [LIMITS.uploadGlobalPerDay, 'all'],
    ]);
    if (!ok) return json(429, { error: 'Příliš mnoho nahrávání. Zkuste to prosím za chvíli.' });

    const result = await put(`uploads/${leadId}/${index}.${EXTENSIONS[type]}`, Buffer.from(bytes), {
      access: 'private',
      contentType: type,
      addRandomSuffix: true,
    });
    return json(200, { pathname: result.pathname });
  } catch (error) {
    console.error('upload error', error);
    return json(503, { error: 'Nahrávání je dočasně nedostupné. Napište nám prosím na info@bezmodelky.cz.' });
  }
}
