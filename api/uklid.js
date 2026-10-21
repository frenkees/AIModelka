// Denní úklid (Vercel Cron): maže nahrané fotky starší 90 dnů a poptávky starší 1 roku.
import { del, list } from '@vercel/blob';

const DAY = 24 * 60 * 60 * 1000;
const RULES = [
  ['uploads/', 90 * DAY],
  ['leads/', 365 * DAY],
];

export async function GET(request) {
  // Vercel Cron posílá hlavičku Authorization: Bearer <CRON_SECRET>
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  let deleted = 0;
  for (const [prefix, maxAge] of RULES) {
    let cursor;
    do {
      const page = await list({ prefix, cursor, limit: 1000 });
      const old = page.blobs.filter((b) => Date.now() - new Date(b.uploadedAt).getTime() > maxAge).map((b) => b.url);
      if (old.length) await del(old);
      deleted += old.length;
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  }
  return Response.json({ deleted });
}
