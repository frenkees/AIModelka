// Zobrazí soukromou fotku z poptávky přes časově omezený podepsaný odkaz (z e-mailové notifikace).
import { get } from '@vercel/blob';
import { verifySignature } from './_lib.js';

export async function GET(request) {
  const url = new URL(request.url);
  const pathname = url.searchParams.get('p') || '';
  const expiresAt = url.searchParams.get('e') || '';
  const signature = url.searchParams.get('s') || '';

  if (!pathname.startsWith('uploads/') || !verifySignature(pathname, expiresAt, signature)) {
    return new Response('Odkaz je neplatný nebo vypršel.', { status: 403 });
  }

  const result = await get(pathname, { access: 'private' }).catch(() => null);
  if (!result?.stream) return new Response('Fotka nenalezena.', { status: 404 });

  return new Response(result.stream, {
    headers: {
      'Content-Type': result.blob.contentType,
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex',
    },
  });
}
