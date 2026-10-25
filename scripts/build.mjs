// Sestaví produkční web do dist/ – jen soubory, které web skutečně používá.
import { cp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { stripMetadata } from './strip-metadata.mjs';

const OUT = 'dist';
const files = [
  'index.html',
  'podminky.html',
  'zasady-ochrany-osobnich-udaju.html',
  'robots.txt',
  'sitemap.xml',
  'site.webmanifest',
  'og-image.jpg',
  'favicon.ico',
  'favicon-16x16.png',
  'favicon-32x32.png',
  'apple-touch-icon.png',
  'android-chrome-192x192.png',
  'android-chrome-512x512.png',
];

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT);
await Promise.all(files.map((f) => cp(f, `${OUT}/${f}`)));
for (const f of files.filter((f) => f.endsWith('.html'))) {
  await writeFile(`${OUT}/${f}`, typography(withFaqSchema(await readFile(f, 'utf8'))));
}
await cp('assets', `${OUT}/assets`, { recursive: true });

// Karusel v hero: webp obrázky + kompaktní data bez absolutních cest na disku
await cp('karusel/web', `${OUT}/karusel/web`, { recursive: true });
const karusel = JSON.parse(await readFile('karusel/karusel.json', 'utf8'));
await writeFile(`${OUT}/karusel/data.json`, JSON.stringify(karuselData(karusel)));

// Pojistka: na web nesmí odejít žádná metadata obrázků (EXIF, poznámky, workflow z ComfyUI…)
await stripMetadata([OUT], { quiet: true });

console.log(`dist/ připraven (${files.length} souborů + assets/ + karusel/)`);

// Snímek se ukládá jako [základ URL, výška při šířce 832]; prohlížeč si doplní -200/-416/-624/-832.webp
function karuselData(k) {
  const shot = (s) => {
    const base = s.nahled.url.replace(/-200\.webp$/, '');
    for (const o of s.obrazky) {
      if (o.url !== `${base}-${o.w}.webp`) throw new Error(`karusel.json: nečekaná URL ${o.url}`);
    }
    return [base, s.obrazky.at(-1).h];
  };
  return {
    sirky: k.sirky,
    pozy: k.pozy,
    modelky: k.modelky.map((m) => ({
      id: m.id,
      jmeno: m.jmeno,
      postava: m.postava,
      zaklad: Object.fromEntries(m.zaklad.map((z) => [z.poza, shot(z)])),
    })),
    outfity: k.outfity.map((o) => ({
      id: o.id,
      nazev: o.nazev,
      kusy: o.kusy.map((kus) => kus.obrazky[0].url),
    })),
    // Snímky, které kontrola kvality ohodnotila pod 5, vynecháme (null = kontrola neproběhla)
    snimky: Object.fromEntries(k.snimky
      .filter((s) => s.qc_skore == null || s.qc_skore >= 5)
      .map((s) => [`${s.modelka}|${s.outfit}|${s.poza}`, shot(s)])),
  };
}

// Strukturovaná data FAQ se skládají z viditelných otázek, aby se texty nerozcházely
function withFaqSchema(html) {
  const faq = [...html.matchAll(/<details[^>]*>\s*<summary[^>]*><h3[^>]*>(.*?)<\/h3>.*?<\/summary>\s*<p[^>]*>(.*?)<\/p>\s*<\/details>/gs)];
  if (!faq.length) return html;
  const text = (s) => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
  const entity = {
    '@type': 'FAQPage',
    '@id': 'https://www.bezmodelky.cz/#faq',
    mainEntity: faq.map(([, q, a]) => ({ '@type': 'Question', name: text(q), acceptedAnswer: { '@type': 'Answer', text: text(a) } })),
  };
  return html.replace(/(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/, (_, open, json, close) => {
    const data = JSON.parse(json);
    data['@graph'].push(entity);
    return `${open}\n${JSON.stringify(data, null, 2)}\n${close}`;
  });
}

// České typografické mezery jen ve viditelném textu: jednopísmenné předložky a spojky
// a číslo s jednotkou se nesmí rozdělit na konec a začátek řádku.
function typography(html) {
  const units = 'Kč|%|h|hodin|dní|dnů|dny|fotek|fotky|fotka|fotku|týdny|MB|×';
  const unit = new RegExp(String.raw`(\d) (${units})(?=[\s.,;:)!?]|$)`, 'g');
  const single = /(^|[\s(„])([kKsSvVzZoOuUaAiI]) (?=\S)/g;
  return html.replace(/(<(script|style|textarea)\b[\s\S]*?<\/\2>)|>([^<]+)(?=<)/g, (m, raw, _tag, text) => {
    if (raw) return raw;
    // dvakrát kvůli sousedním předložkám („a v Praze“)
    return '>' + text.replace(single, '$1$2&nbsp;').replace(single, '$1$2&nbsp;').replace(unit, '$1&nbsp;$2');
  });
}
