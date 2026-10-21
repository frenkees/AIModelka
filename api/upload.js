// Vydává krátkodobé tokeny pro přímé nahrání fotky z prohlížeče do soukromého Vercel Blob úložiště.
// Server samotná data fotek nepřijímá – jen ověří kontakt, limity a omezí, co a kam se smí nahrát.
import { handleUpload } from '@vercel/blob/client';
import {
  ALLOWED_TYPES, LIMITS, MAX_FILE_BYTES, UPLOAD_PATH_RE,
  clientIp, json, looksLikeBot, normalizeEmail, normalizePhone, readJson, sameOrigin, withinLimits,
} from './_lib.js';

class Rejected extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function POST(request) {
  if (!sameOrigin(request)) return json(403, { error: 'Nepovolený původ požadavku.' });

  let body;
  try {
    body = await readJson(request, 4096);
  } catch {
    return json(400, { error: 'Neplatný požadavek.' });
  }
  // Přijímáme jen žádosti o token, žádné jiné akce
  if (body?.type !== 'blob.generate-client-token') return json(400, { error: 'Neplatný požadavek.' });

  const ip = clientIp(request);

  try {
    const result = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname, clientPayload, multipart) => {
        if (multipart || !UPLOAD_PATH_RE.test(pathname)) throw new Rejected(400, 'Neplatný soubor.');

        let payload;
        try {
          payload = JSON.parse(clientPayload || '{}');
        } catch {
          throw new Rejected(400, 'Neplatný požadavek.');
        }
        if (looksLikeBot(payload)) throw new Rejected(400, 'Formulář se nepodařilo ověřit, zkuste to prosím znovu.');
        if (!normalizeEmail(payload.email)) throw new Rejected(400, 'Zadejte prosím platný e-mail.');
        if (!normalizePhone(payload.phone)) throw new Rejected(400, 'Zadejte prosím platné telefonní číslo.');

        const ok = await withinLimits([
          [LIMITS.uploadPerMinute, ip],
          [LIMITS.uploadPerDay, ip],
          [LIMITS.uploadGlobalPerDay, 'all'],
        ]);
        if (!ok) throw new Rejected(429, 'Příliš mnoho nahrávání. Zkuste to prosím za chvíli.');

        return {
          allowedContentTypes: ALLOWED_TYPES,
          maximumSizeInBytes: MAX_FILE_BYTES,
          validUntil: Date.now() + 5 * 60 * 1000,
          addRandomSuffix: true,
          allowOverwrite: false,
        };
      },
    });
    return json(200, result);
  } catch (error) {
    if (error instanceof Rejected) return json(error.status, { error: error.message });
    console.error('upload token error', error);
    return json(503, { error: 'Nahrávání je dočasně nedostupné. Napište nám prosím na info@bezmodelky.cz.' });
  }
}
