// Sestaví produkční web do dist/ – jen soubory, které web skutečně používá.
import { cp, rm, mkdir } from 'node:fs/promises';

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
await cp('assets', `${OUT}/assets`, { recursive: true });
console.log(`dist/ připraven (${files.length} souborů + assets/)`);
