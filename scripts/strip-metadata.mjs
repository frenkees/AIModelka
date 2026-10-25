// Bezztrátově odstraní z obrázků metadata (EXIF, XMP, ICC, textové poznámky, C2PA, workflow z ComfyUI).
// Obrazová data se nepřekódovávají, jen se vyhodí nepotřebné bloky. AVIF jen kontroluje.
// Použití: node scripts/strip-metadata.mjs [složky nebo soubory…]  (bez argumentů = obrázky v repozitáři)
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_TARGETS = ['.', 'assets', 'karusel/web', 'high_fashion', 'sporty', 'street', 'summer'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.vercel', '_png', '_skript']);

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND']);
const WEBP_KEEP = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ANIM', 'ANMF']);

function stripPng(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIG)) return null;
  const parts = [PNG_SIG];
  for (let i = 8; i < buf.length;) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('latin1', i + 4, i + 8);
    if (PNG_KEEP.has(type)) parts.push(buf.subarray(i, i + 12 + len));
    i += 12 + len;
  }
  return Buffer.concat(parts);
}

function stripWebp(buf) {
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') return null;
  const parts = [];
  for (let i = 12; i + 8 <= buf.length;) {
    const type = buf.toString('latin1', i, i + 4);
    const len = buf.readUInt32LE(i + 4);
    const end = i + 8 + len + (len & 1);
    if (WEBP_KEEP.has(type)) {
      const chunk = Buffer.from(buf.subarray(i, end));
      if (type === 'VP8X') chunk[8] &= ~(0x20 | 0x08 | 0x04); // příznaky ICC, EXIF, XMP
      parts.push(chunk);
    }
    i = end;
  }
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(body.length + 4, 4);
  head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, body]);
}

function stripJpeg(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  const parts = [buf.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= buf.length && buf[i] === 0xff) {
    const marker = buf[i + 1];
    if (marker === 0xda) break; // od začátku obrazových dat kopírujeme vše
    const len = buf.readUInt16BE(i + 2);
    // APP0 (JFIF hlavička) necháme, APP1–APP15 (EXIF, XMP, ICC, Photoshop…) a COM (komentář) pryč
    const meta = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!meta) parts.push(buf.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  parts.push(buf.subarray(i));
  return Buffer.concat(parts);
}

// AVIF neumíme bezztrátově přepsat, jen ověříme, že v něm nejsou EXIF/XMP položky
const avifHasMeta = (buf) => buf.includes('Exif') || buf.includes('application/rdf+xml');

const STRIP = { '.png': stripPng, '.webp': stripWebp, '.jpg': stripJpeg, '.jpeg': stripJpeg };

async function* walk(path) {
  const s = await stat(path);
  if (s.isFile()) { yield path; return; }
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      // Kořen repozitáře procházíme jen mělce, podsložky mají vlastní cíle
      if (SKIP_DIRS.has(entry.name) || path === '.') continue;
      yield* walk(join(path, entry.name));
    } else yield join(path, entry.name);
  }
}

export async function stripMetadata(targets = DEFAULT_TARGETS, { quiet = false } = {}) {
  let checked = 0;
  let cleaned = 0;
  const avifWarnings = [];
  for (const target of targets) {
    for await (const file of walk(target)) {
      const ext = extname(file).toLowerCase();
      if (ext === '.avif') {
        checked++;
        if (avifHasMeta(await readFile(file))) avifWarnings.push(file);
        continue;
      }
      const strip = STRIP[ext];
      if (!strip) continue;
      checked++;
      const buf = await readFile(file);
      const out = strip(buf);
      if (out && !out.equals(buf)) {
        await writeFile(file, out);
        cleaned++;
        if (!quiet) console.log(`  vyčištěno: ${file} (−${buf.length - out.length} B)`);
      }
    }
  }
  console.log(`metadata: zkontrolováno ${checked} obrázků, vyčištěno ${cleaned}`);
  if (avifWarnings.length) console.warn(`POZOR, AVIF s metadaty (nutno přegenerovat): ${avifWarnings.join(', ')}`);
  return { checked, cleaned, avifWarnings };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  await stripMetadata(args.length ? args : DEFAULT_TARGETS);
}
