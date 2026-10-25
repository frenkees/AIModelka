// Výběr jazyka na úvodní stránce (Vercel Routing Middleware, běží jen pro „/“).
//   1. ?lang=xx  → uloží volbu do cookie a otevře úvodní stránku v tom jazyce
//   2. cookie    → volba z přepínače má přednost před nastavením prohlížeče
//   3. Accept-Language → první podporovaný jazyk podle priority, jinak angličtina
// Roboti a požadavky bez Accept-Language (Googlebot) zůstávají na české verzi,
// aby se každá jazyková verze indexovala na své adrese.
export const config = { matcher: '/' };

const HOME = { cs: '/', en: '/en', sk: '/sk', de: '/de', zh: '/zh' };
const BOT = /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|lighthouse|headless/i;
const YEAR = 60 * 60 * 24 * 365;

export default function middleware(request) {
  const url = new URL(request.url);
  const asked = url.searchParams.get('lang');
  if (asked && HOME[asked]) {
    return redirect(new URL(HOME[asked], url), `lang=${asked}; Path=/; Max-Age=${YEAR}; SameSite=Lax; Secure`);
  }

  const saved = /(?:^|;\s*)lang=([a-z]{2})(?:;|$)/.exec(request.headers.get('cookie') ?? '')?.[1];
  if (saved && HOME[saved]) return saved === 'cs' ? undefined : redirect(new URL(HOME[saved], url));

  if (BOT.test(request.headers.get('user-agent') ?? '')) return undefined;
  const lang = pick(request.headers.get('accept-language'));
  if (!lang || lang === 'cs') return undefined;
  return redirect(new URL(HOME[lang], url));
}

// „sk-SK,sk;q=0.9,cs;q=0.8,en;q=0.7“ → 'sk'; zh-TW, de-AT apod. na nejbližší podporovaný jazyk
export function pick(header) {
  if (!header) return null;
  const ranked = header.split(',')
    .map((part, i) => {
      const [tag, ...params] = part.trim().toLowerCase().split(';');
      const q = Number(params.find((p) => p.trim().startsWith('q='))?.split('=')[1] ?? 1);
      return { base: tag.split('-')[0], q: Number.isFinite(q) ? q : 0, i };
    })
    .filter((x) => x.base && x.base !== '*' && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  if (!ranked.length) return null;
  return ranked.find((x) => HOME[x.base])?.base ?? 'en';
}

function redirect(location, cookie) {
  const headers = { Location: location.href, 'Cache-Control': 'no-store', Vary: 'Accept-Language, Cookie' };
  if (cookie) headers['Set-Cookie'] = cookie;
  return new Response(null, { status: 307, headers });
}
