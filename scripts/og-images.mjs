// OG obrázky 1200×630 (náhled při sdílení odkazu) pro každý jazyk webu.
// Spouští se ručně (npm run images:og), výstupy se commitují.
import sharp from 'sharp';

const TEXTS = {
  cs: { file: 'og-image.jpg', t1: 'AI fotky oblečení', t2: 'pro e-shopy', l1: 'Z ramínka na modelku do 24 hodin.', l2: 'Bez focení, stačí fotka z mobilu.', foot: 'Od 69 Kč za fotku · 1 fotka zdarma' },
  en: { file: 'og-image-en.jpg', t1: 'AI fashion photos', t2: 'for online stores', l1: 'From hanger to model in 24 hours.', l2: 'No photo shoot, just a phone photo.', foot: 'From CZK 69 per photo · first photo free' },
  sk: { file: 'og-image-sk.jpg', t1: 'AI fotky oblečenia', t2: 'pre e-shopy', l1: 'Z vešiaka na modelku do 24 hodín.', l2: 'Bez fotenia, stačí fotka z mobilu.', foot: 'Od 69 CZK za fotku · 1 fotka zadarmo' },
  de: { file: 'og-image-de.jpg', t1: 'KI-Modelfotos', t2: 'für Online-Shops', l1: 'Vom Bügel aufs Model in 24 Stunden.', l2: 'Kein Shooting – ein Handyfoto genügt.', foot: 'Ab 69 CZK pro Foto · erstes Foto gratis' },
  zh: { file: 'og-image-zh.jpg', t1: 'AI 服装模特图', t2: '专为网店打造', l1: '衣架上的照片，24 小时变成模特上身图。', l2: '无需拍摄，一张手机照片即可。', foot: '每张 69 捷克克朗起 · 首张免费', cjk: true },
};

const PHOTOS = ['assets/img/high-fashion-cerne-sako-sede-kalhoty-832.webp', 'assets/img/letni-modra-halenka-bile-kalhoty-832.webp'];
const photoW = 210, photoH = 315, gap = 20;
const startX = 1200 - 48 - (photoW * 2 + gap);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const photos = await Promise.all(PHOTOS.map(async (p, i) => ({
  input: await sharp(p).resize(photoW, photoH, { fit: 'cover', position: 'top' })
    .composite([{ input: Buffer.from(`<svg width="${photoW}" height="${photoH}"><rect width="${photoW}" height="${photoH}" rx="14" fill="#fff"/></svg>`), blend: 'dest-in' }])
    .png().toBuffer(),
  left: startX + i * (photoW + gap),
  top: Math.round((630 - photoH) / 2) + (i === 0 ? -20 : 20),
})));

for (const { file, t1, t2, l1, l2, foot, cjk } of Object.values(TEXTS)) {
  const serif = cjk ? "'Microsoft YaHei', 'PingFang SC', sans-serif" : 'Georgia, serif';
  const sans = cjk ? "'Microsoft YaHei', 'PingFang SC', sans-serif" : 'Arial, sans-serif';
  const svg = Buffer.from(`
<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#3A57C4"/><stop offset="1" stop-color="#5FCFE3"/></linearGradient></defs>
  <rect width="1200" height="630" fill="#FAF8F5"/>
  <rect x="0" y="0" width="1200" height="8" fill="url(#g)"/>
  <text x="56" y="110" font-family="Georgia, serif" font-size="30" fill="#14161C" font-weight="700">BezModelky<tspan fill="#3A57C4">.cz</tspan></text>
  <text x="56" y="250" font-family="${serif}" font-size="54" fill="#14161C">${esc(t1)}</text>
  <text x="56" y="320" font-family="${serif}" font-size="54" fill="#14161C"${cjk ? '' : ' font-style="italic"'}>${esc(t2)}</text>
  <text x="56" y="400" font-family="${sans}" font-size="24" fill="#5B5F6B">${esc(l1)}</text>
  <text x="56" y="436" font-family="${sans}" font-size="24" fill="#5B5F6B">${esc(l2)}</text>
  <text x="56" y="540" font-family="${sans}" font-size="22" fill="#14161C" font-weight="700">${esc(foot)}</text>
</svg>`);
  await sharp(svg).composite(photos).jpeg({ quality: 82, mozjpeg: true }).toFile(file);
  console.log(`  ${file}`);
}
