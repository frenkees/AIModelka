// Jazykové verze webu. Zdrojem pravdy jsou české stránky, překlady jsou v i18n/<jazyk>.json:
//   "html": český úsek textu → překlad (text mezi značkami nebo hodnota atributu alt/title/…)
//   "js":   český řetězec ze skriptů → překlad (karusel, formulář; vloží se do stránky jako JSON)
// Build selže, když v cizojazyčné stránce zůstane nepřeložený text nebo když klíč z překladu
// v české předloze chybí (předloha se změnila a překlad je potřeba upravit).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export const SITE = 'https://www.bezmodelky.cz';

export const LANGS = {
  cs: { html: 'cs', hreflang: 'cs', locale: 'cs_CZ', name: 'Čeština', flag: 'cz', label: 'Změnit jazyk' },
  en: { html: 'en', hreflang: 'en', locale: 'en_GB', name: 'English', flag: 'gb', label: 'Change language' },
  sk: { html: 'sk', hreflang: 'sk', locale: 'sk_SK', name: 'Slovenčina', flag: 'sk', label: 'Zmeniť jazyk' },
  de: { html: 'de', hreflang: 'de', locale: 'de_DE', name: 'Deutsch', flag: 'de', label: 'Sprache ändern' },
  zh: { html: 'zh-Hans', hreflang: 'zh-Hans', locale: 'zh_CN', name: '简体中文', flag: 'cn', label: '切换语言' },
};

export const PAGES = {
  home: { src: 'index.html', slug: { cs: '', en: '', sk: '', de: '', zh: '' } },
  terms: { src: 'podminky.html', slug: { cs: 'podminky', en: 'terms', sk: 'obchodne-podmienky', de: 'agb', zh: 'terms' } },
  privacy: {
    src: 'zasady-ochrany-osobnich-udaju.html',
    slug: { cs: 'zasady-ochrany-osobnich-udaju', en: 'privacy', sk: 'ochrana-osobnych-udajov', de: 'datenschutz', zh: 'privacy' },
  },
};

// Adresa stránky v jazyce (bez koncového lomítka, cleanUrls)
export const pathOf = (page, lang) => {
  const slug = PAGES[page].slug[lang];
  if (lang === 'cs') return `/${slug}`;
  return slug ? `/${lang}/${slug}` : `/${lang}`;
};
const fileOf = (page, lang) => {
  const p = pathOf(page, lang);
  return p === '/' ? 'index.html' : page === 'home' ? `${lang}/index.html` : `${p.slice(1)}.html`;
};
export const ogImageOf = (lang) => (lang === 'cs' ? '/og-image.jpg' : `/og-image-${lang}.jpg`);

// Atributy s textem pro lidi; href jen kvůli předmětu v mailto odkazu
const TEXT_ATTRS = ['alt', 'title', 'aria-label', 'placeholder', 'data-alt', 'content', 'href'];
const CHECK_ATTRS = ['alt', 'title', 'aria-label', 'placeholder', 'data-alt'];
// Meta značky, jejichž content je text pro lidi
const TEXT_META = /<meta (?:name|property)="(?:description|og:title|og:description|og:image:alt|twitter:title|twitter:description)" content="([^"]*)"/g;
const RAW = /<(script|style)\b[\s\S]*?<\/\1>/g;
const LETTERS = /\p{L}/u;
// Česká diakritika, která se v jiném jazyce objevit nesmí (slovenština sdílí většinu, kromě ě, ř, ů)
const CZECH_ONLY = { sk: /[ěřůĚŘŮ]/, default: /[áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/ };
// Vlastní jména a údaje, které se nepřekládají
const KEEP_CZECH = ['Procházka', 'Kyjevská 333/2, 503 41 Hradec Králové', 'Česká obchodní inspekce', 'ČOI', 'Štěpánská 567/15, 120 00 Praha 2', 'Čeština', 'č. 89/2012 Sb.', 'IČO'];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Mezery v klíči odpovídají libovolným bílým znakům v předloze (zalomení řádků v HTML)
const flexible = (key) => escapeRe(key).replace(/\s+/g, '\\s+');

export async function loadDicts() {
  const dicts = {};
  for (const lang of Object.keys(LANGS)) {
    if (lang === 'cs') continue;
    dicts[lang] = JSON.parse(await readFile(`i18n/${lang}.json`, 'utf8'));
  }
  return dicts;
}

// Nahradí úseky překladem. Vrací HTML a seznam použitých klíčů.
function translate(html, dict) {
  const used = new Set();
  const tokens = [];
  const keys = Object.keys(dict).sort((a, b) => b.length - a.length);
  // Skripty a styly se nepřekládají (JSON-LD řeší translateJsonLd)
  const raws = [];
  let out = html.replace(RAW, (m) => `\u0003${raws.push(m) - 1}\u0003`);
  for (const key of keys) {
    const body = flexible(key);
    const re = new RegExp(`(?<=>\\s*)${body}(?=\\s*<)|(?<=\\b(?:${TEXT_ATTRS.join('|')})=")${body}(?=")`, 'g');
    out = out.replace(re, () => {
      used.add(key);
      return `\u0001${tokens.push(dict[key]) - 1}\u0002`;
    });
  }
  return { tokenized: out, tokens, raws, used };
}

const restore = ({ tokenized, tokens, raws }) =>
  tokenized.replace(/\u0001(\d+)\u0002/g, (_, i) => tokens[i]).replace(/\u0003(\d+)\u0003/g, (_, i) => raws[i]);

// Najde text, který zůstal česky (není celý pokrytý tokenem překladu)
function leftovers(tokenized) {
  const found = [];
  const bare = (s) => s.replace(/\u0001\d+\u0002/g, '').replace(/&[a-z]+;|&#\d+;/g, ' ');
  for (const m of tokenized.matchAll(/>([^<]+)</g)) {
    const rest = bare(m[1]);
    if (LETTERS.test(rest)) found.push(m[1].trim());
  }
  for (const attr of CHECK_ATTRS) {
    for (const m of tokenized.matchAll(new RegExp(`\\b${attr}="([^"]*)"`, 'g'))) {
      if (LETTERS.test(bare(m[1]))) found.push(`${attr}="${m[1]}"`);
    }
  }
  for (const m of tokenized.matchAll(TEXT_META)) {
    if (LETTERS.test(bare(m[1]))) found.push(`meta "${m[1]}"`);
  }
  return found;
}

// Strukturovaná data: přeloží texty, upraví adresy a jazyk
function translateJsonLd(html, { lang, page, dict, problems, used }) {
  return html.replace(/(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/, (_, open, json, close) => {
    const data = JSON.parse(json);
    const url = SITE + pathOf(page, lang);
    for (const node of data['@graph']) {
      if (lang !== 'cs') {
        if (node['@type'] === 'Service') delete node.areaServed;
        for (const field of ['name', 'description', 'serviceType', 'unitText']) walk(node, field);
      }
      if (node['@type'] === 'WebSite') node.inLanguage = LANGS[lang].html;
      if (node['@type'] === 'Service') node.image = SITE + ogImageOf(lang);
    }
    data['@graph'].push(...faqSchema(html, url));
    return `${open}\n${JSON.stringify(data, null, 2)}\n${close}`;
  });

  function walk(node, field) {
    if (Array.isArray(node)) return node.forEach((n) => walk(n, field));
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (k === field && typeof v === 'string' && v !== 'BezModelky.cz') {
        if (dict[v] == null) problems.push(`JSON-LD bez překladu: ${v}`);
        else {
          used?.add(v);
          node[k] = dict[v].replace(/<[^>]+>/g, '');
        }
      } else if (typeof v === 'object') walk(v, field);
    }
  }
}

// FAQ ve strukturovaných datech se skládá z viditelných otázek, aby se texty nerozcházely
function faqSchema(html, url) {
  const faq = [...html.matchAll(/<details[^>]*>\s*<summary[^>]*><h3[^>]*>(.*?)<\/h3>.*?<\/summary>\s*<p[^>]*>(.*?)<\/p>\s*<\/details>/gs)];
  if (!faq.length) return [];
  const text = (s) => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  return [{
    '@type': 'FAQPage',
    '@id': `${url}#faq`,
    mainEntity: faq.map(([, q, a]) => ({ '@type': 'Question', name: text(q), acceptedAnswer: { '@type': 'Answer', text: text(a) } })),
  }];
}

// Hlavička: jazyk, kanonická adresa, hreflang, Open Graph
function seo(html, { lang, page }) {
  const L = LANGS[lang];
  const url = SITE + pathOf(page, lang);
  let out = html
    .replace(/<html lang="cs"/, `<html lang="${L.html}"`)
    .replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${url}">`)
    .replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${url}">`)
    .replace(/<meta property="og:locale" content="[^"]*">/, () =>
      [`<meta property="og:locale" content="${L.locale}">`,
        ...Object.entries(LANGS).filter(([k]) => k !== lang).map(([, o]) => `<meta property="og:locale:alternate" content="${o.locale}">`)].join('\n    '))
    .replace(/(<meta (?:property|name)="(?:og|twitter):image" content=")[^"]*(">)/g, `$1${SITE}${ogImageOf(lang)}$2`);
  // Alternativy jen u indexovaných stránek (právní texty mají noindex)
  if (!/<meta name="robots" content="noindex/.test(out)) {
    const alts = Object.entries(LANGS).map(([k, o]) => `<link rel="alternate" hreflang="${o.hreflang}" href="${SITE}${pathOf(page, k)}">`);
    alts.push(`<link rel="alternate" hreflang="x-default" href="${SITE}${pathOf(page, 'en')}">`);
    out = out.replace(/(<link rel="canonical" href="[^"]*">)/, `$1\n    ${alts.join('\n    ')}`);
  }
  return out;
}

// Odkazy mezi stránkami a cesty k souborům (cizojazyčné stránky leží v podsložce)
function links(html, { lang }) {
  return html
    .replace(/href="\/"/g, `href="${pathOf('home', lang)}"`)
    .replace(/href="\/podminky"/g, `href="${pathOf('terms', lang)}"`)
    .replace(/href="\/zasady-ochrany-osobnich-udaju"/g, `href="${pathOf('privacy', lang)}"`)
    .replace(/((?:src|href)=")assets\//g, '$1/assets/')
    .replace(/(srcset="[^"]*")/g, (m) => m.replace(/(^srcset="|,\s*)assets\//g, '$1/assets/'));
}

// Přepínač jazyka: kolečko s vlajkou, funguje i bez JavaScriptu (<details>)
function switcher(html, { lang, page }) {
  const L = LANGS[lang];
  const flag = (code) => `<img src="/assets/img/flags/${code}.svg" width="22" height="22" alt="" class="lang__flag">`;
  const items = Object.entries(LANGS).map(([k, o]) => {
    // Česká úvodní stránka s ?lang=cs, ať automatický výběr jazyka volbu nepřebije
    const href = k === 'cs' && page === 'home' ? '/?lang=cs' : pathOf(page, k);
    const current = k === lang ? ' aria-current="page"' : '';
    return `<li><a href="${href}" hreflang="${o.hreflang}" lang="${o.html}" data-lang="${k}"${current}>${flag(o.flag)}${o.name}</a></li>`;
  });
  const markup = `<details class="lang">
            <summary class="lang__btn" aria-label="${L.label} (${L.name})" title="${L.label}">${flag(L.flag)}</summary>
            <ul class="lang__menu">${items.join('')}</ul>
        </details>`;
  return html.replace('<!-- jazyk -->', markup);
}

// Typografie: číslo a jednotka se nedělí; v češtině a slovenštině ani jednopísmenné předložky
function typography(html, lang) {
  const units = 'Kč|CZK|%|h|hodin|hodín|dní|dnů|dny|fotek|fotky|fotka|fotku|fotiek|týdny|týždne|MB|×|Stunden|Tage|Fotos|hours|days|photos';
  const unit = new RegExp(String.raw`(\d) (${units})(?=[\s.,;:)!?/]|$)`, 'g');
  const single = /(^|[\s(„])([kKsSvVzZoOuUaAiI]) (?=\S)/g;
  return html.replace(/(<(script|style|textarea)\b[\s\S]*?<\/\2>)|>([^<]+)(?=<)/g, (m, raw, _tag, text) => {
    if (raw) return raw;
    let t = text.replace(unit, '$1&nbsp;$2');
    // dvakrát kvůli sousedním předložkám („a v Praze“)
    if (lang === 'cs' || lang === 'sk') t = t.replace(single, '$1$2&nbsp;').replace(single, '$1$2&nbsp;');
    return '>' + t;
  });
}

const jsDict = (dict) =>
  `<script type="application/json" id="i18n">${JSON.stringify(dict).replace(/</g, '\\u003c')}</script>\n</body>`;

function checkLanguage(html, lang) {
  const re = CZECH_ONLY[lang] ?? CZECH_ONLY.default;
  const text = html.replace(RAW, '').replace(/<[^>]+>/g, ' ');
  const stripped = KEEP_CZECH.reduce((s, k) => s.split(k).join(' '), text);
  return [...new Set(stripped.match(new RegExp(`\\S*${re.source}\\S*`, 'g')) ?? [])];
}

// Sestaví všechny stránky ve všech jazycích do složky out
export async function buildPages(out) {
  const dicts = await loadDicts();
  const problems = [];
  const usedAll = Object.fromEntries(Object.keys(dicts).map((l) => [l, new Set()]));
  const written = [];

  for (const [page, { src }] of Object.entries(PAGES)) {
    const source = await readFile(src, 'utf8');
    for (const lang of Object.keys(LANGS)) {
      let html = source;
      const dict = dicts[lang]?.html ?? {};
      if (lang !== 'cs') {
        const result = translate(html, dict);
        result.used.forEach((k) => usedAll[lang].add(k));
        for (const left of leftovers(result.tokenized)) problems.push(`[${lang}] ${src}: nepřeloženo: ${left.slice(0, 120)}`);
        html = restore(result);
        for (const word of checkLanguage(html, lang)) problems.push(`[${lang}] ${src}: česká diakritika: ${word}`);
        html = html.replace('</body>', jsDict(dicts[lang].js ?? {}));
        // Právní texty: závazná je česká verze
        if (page !== 'home') {
          html = html.replace('</h1>', `</h1>\n        <p class="legal-note">${dicts[lang].notice.replace('{href}', pathOf(page, 'cs'))}</p>`);
        }
      }
      html = translateJsonLd(html, { lang, page, dict, problems, used: usedAll[lang] });
      html = seo(html, { lang, page });
      html = links(html, { lang });
      html = switcher(html, { lang, page });
      html = typography(html, lang);
      const file = `${out}/${fileOf(page, lang)}`;
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, html);
      written.push(file);
    }
  }

  for (const [lang, used] of Object.entries(usedAll)) {
    for (const key of Object.keys(dicts[lang].html)) {
      if (!used.has(key)) problems.push(`[${lang}] klíč nenalezen v předloze: ${key.slice(0, 120)}`);
      if (/"/.test(dicts[lang].html[key].replace(/<[^>]+>/g, ''))) problems.push(`[${lang}] rovné uvozovky v překladu: ${key.slice(0, 80)}`);
    }
  }
  problems.push(...(await checkJsKeys(dicts)));
  if (problems.length) throw new Error(`Překlady nejsou kompletní (${problems.length}):\n  ${problems.join('\n  ')}`);
  await writeFile(`${out}/sitemap.xml`, sitemap());
  return written;
}

// Každý řetězec z t('…') ve skriptech a každý název z dat karuselu musí mít překlad
async function checkJsKeys(dicts) {
  const keys = new Set();
  for (const f of ['src/karusel.js', 'src/upload.js', 'assets/main.js']) {
    const code = await readFile(f, 'utf8');
    for (const m of code.matchAll(/\bt\('((?:[^'\\]|\\.)+)'/g)) keys.add(m[1]);
  }
  const k = JSON.parse(await readFile('karusel/karusel.json', 'utf8'));
  k.modelky.forEach((m) => keys.add(m.postava));
  k.outfity.forEach((o) => keys.add(o.nazev));
  k.pozy.forEach((p) => keys.add(p.nazev));
  for (const msg of await apiMessages()) keys.add(msg);
  const problems = [];
  for (const [lang, dict] of Object.entries(dicts)) {
    for (const key of keys) if (!(key in (dict.js ?? {}))) problems.push(`[${lang}] js bez překladu: ${key}`);
  }
  return problems;
}

// Chybové hlášky API jsou česky; prohlížeč je přeloží přes t()
async function apiMessages() {
  const msgs = new Set();
  for (const f of ['api/upload.js', 'api/poptavka.js']) {
    const code = await readFile(f, 'utf8');
    for (const m of code.matchAll(/error: '([^']+)'/g)) msgs.add(m[1]);
  }
  return msgs;
}

function sitemap() {
  const today = new Date().toISOString().slice(0, 10);
  const urls = Object.keys(LANGS).map((lang) => {
    const alts = Object.entries(LANGS)
      .map(([k, o]) => `      <xhtml:link rel="alternate" hreflang="${o.hreflang}" href="${SITE}${pathOf('home', k)}"/>`)
      .concat(`      <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}${pathOf('home', 'en')}"/>`);
    return `   <url>\n      <loc>${SITE}${pathOf('home', lang)}</loc>\n      <lastmod>${today}</lastmod>\n${alts.join('\n')}\n   </url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`;
}
