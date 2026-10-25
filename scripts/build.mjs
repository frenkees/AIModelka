// Sestaví produkční web do dist/ – jen soubory, které web skutečně používá.
import { cp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { stripMetadata } from './strip-metadata.mjs';
import { buildPages } from './i18n.mjs';

const OUT = 'dist';
const files = [
  'robots.txt',
  'site.webmanifest',
  'og-image.jpg',
  'og-image-en.jpg',
  'og-image-sk.jpg',
  'og-image-de.jpg',
  'og-image-zh.jpg',
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
// Stránky ve všech jazycích (cs, en, sk, de, zh) + sitemap.xml
const pages = await buildPages(OUT);
await cp('assets', `${OUT}/assets`, { recursive: true });

// Karusel v hero: webp obrázky + kompaktní data bez absolutních cest na disku
await cp('karusel/web', `${OUT}/karusel/web`, { recursive: true });
const karusel = JSON.parse(await readFile('karusel/karusel.json', 'utf8'));
await writeFile(`${OUT}/karusel/data.json`, JSON.stringify(karuselData(karusel)));

// Pojistka: na web nesmí odejít žádná metadata obrázků (EXIF, poznámky, workflow z ComfyUI…)
await stripMetadata([OUT], { quiet: true });

console.log(`dist/ připraven (${pages.length} stránek, ${files.length} souborů + assets/ + karusel/)`);

// Snímek se ukládá jako [základ URL, výška při šířce 832]; prohlížeč si doplní -200/-416/-624/-832.webp
function karuselData(k) {
  const shot = (s) => {
    const base = s.nahled.url.replace(/-200\.webp$/, '');
    for (const o of s.obrazky) {
      if (o.url !== `${base}-${o.w}.webp`) throw new Error(`karusel.json: nečekaná URL ${o.url}`);
    }
    // Otisk největší varianty – všechny šířky vznikají z jednoho PNG naráz
    const v = createHash('sha1').update(readFileSync(`${base.replace(/^\//, '')}-${s.obrazky.at(-1).w}.webp`)).digest('hex').slice(0, 8);
    return [base, s.obrazky.at(-1).h, v];
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
