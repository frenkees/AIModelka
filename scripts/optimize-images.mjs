// Generuje optimalizované obrázky do assets/img z PNG originálů.
// Spouští se ručně (npm run images), výstupy se commitují.
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

const OUT = 'assets/img';

// [zdroj, cílový slug, typ]  typ: final | input | base
const images = [
  ['high_fashion/ComfyUI_final00001_.png', 'high-fashion-cerne-sako-sede-kalhoty', 'final'],
  ['high_fashion/ComfyUI_final00002_.png', 'high-fashion-bile-sako-vinova-sukne', 'final'],
  ['high_fashion/flux_krea_mod1base_00001_.png', 'high-fashion-ai-modelka', 'base'],
  ['high_fashion/flux_krea_mod1_00007_.png', 'cerne-sametove-sako', 'input'],
  ['high_fashion/flux_krea_mod1_00008_.png', 'sede-kalhoty', 'input'],
  ['high_fashion/flux_krea_mod1_00009_.png', 'vinova-pouzdrova-sukne', 'input'],
  ['high_fashion/flux_krea_mod1_00021_.png', 'bile-sako', 'input'],

  ['street/ComfyUI_final00003_.png', 'street-bila-mikina-dziny', 'final'],
  ['street/ComfyUI_final00004_.png', 'street-bomber-bunda-cargo-kalhoty', 'final'],
  ['street/flux_krea_mod1_00010_.png', 'bila-mikina-s-kapuci', 'input'],
  ['street/flux_krea_mod1_00011_.png', 'zelena-bomber-bunda', 'input'],
  ['street/flux_krea_mod1_00012_.png', 'svetle-dziny', 'input'],
  ['street/flux_krea_mod1_00013_.png', 'cerne-cargo-kalhoty', 'input'],

  ['summer/ComfyUI_final00001.png', 'letni-modra-halenka-bile-kalhoty', 'final'],
  ['summer/ComfyUI_final00002.png', 'letni-lneny-top-zavinovaci-sukne', 'final'],
  ['summer/flux_krea_mod1_00014_.png', 'oranzovy-lneny-top', 'input'],
  ['summer/flux_krea_mod1_00015_.png', 'modra-krajkova-halenka', 'input'],
  ['summer/flux_krea_mod1_00016_.png', 'bezova-zavinovaci-sukne', 'input'],
  ['summer/flux_krea_mod1_00017_.png', 'bile-kalhoty', 'input'],

  ['sporty/ComfyUI_final00005_.png', 'outdoor-funkcni-triko-trekove-kalhoty', 'final'],
  ['sporty/ComfyUI_final00006_.png', 'outdoor-funkcni-triko-leginy', 'final'],
  ['sporty/flux_krea_mod1_00018_.png', 'zelene-funkcni-triko', 'input'],
  ['sporty/flux_krea_mod1_00019_.png', 'trekove-kalhoty', 'input'],
  ['sporty/flux_krea_mod1_00020_.png', 'sede-sportovni-leginy', 'input'],
];

// Všechny fotky sjednotíme na poměr 2:3 (832×1248 → zmenšené varianty)
const WIDTHS = { final: [480, 832], base: [480, 832], input: [240] };

await mkdir(OUT, { recursive: true });

for (const [src, slug, type] of images) {
  for (const w of WIDTHS[type]) {
    const h = Math.round(w * 1.5);
    const pipe = sharp(src).resize(w, h, { fit: 'cover', position: 'top' });
    await pipe.clone().webp({ quality: 78, effort: 6 }).toFile(`${OUT}/${slug}-${w}.webp`);
    if (type !== 'input') {
      await pipe.clone().avif({ quality: 55, effort: 6 }).toFile(`${OUT}/${slug}-${w}.avif`);
    }
  }
}

// OG obrázky (náhled při sdílení) ve všech jazycích generuje scripts/og-images.mjs

// Logo pro strukturovaná data (Google vyžaduje rastrový formát)
await sharp('logo.png').resize(600).png({ compressionLevel: 9, palette: true }).toFile(`${OUT}/logo-600.png`);

console.log('Hotovo.');
