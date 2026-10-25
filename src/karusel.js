// Hero karusel AI modelek. Data připravuje scripts/build.mjs z karusel/karusel.json.
// Tři režimy (data-variant na #karusel, na náhledu přepínač ?karusel=a|b|c):
//   a = Šatna: vyberete oblečení a modelku, tažením do stran měníte pózu
//   b = Před/po: posuvník mezi modelkou v body a modelkou v oblečení
//   c = Jedna fotka, šest modelek: produkt se „oblékne“ na všech šest postav naráz
const SIZES = '(min-width: 1024px) 400px, (min-width: 488px) 448px, 92vw';
const TILE_SIZES = '(min-width: 1024px) 130px, 30vw';
const START = { m: '04_sofia', o: '01_letni_saty', p: 1 };
const TILE_POSES = [1, 2, 3, 3, 2, 1];
const STEP_MS = 3400; // tempo ukázkového přehrávání
const MAX_STEPS = 14; // pak se přehrávání zastaví, ať zbytečně nestahujeme data
const VARIANTS = { a: 'Šatna', b: 'Před/po', c: '6 modelek' };
import { t } from './i18n.js';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const ICON = {
  prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
  both: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6-6 6 6 6M15 6l6 6-6 6"/></svg>',
  hand: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 3v20l5-4.6 3.6 8.1 3.7-1.6-3.6-8H22Z" fill="#fff" stroke="#14161c" stroke-width="1.7" stroke-linejoin="round"/></svg>',
};

const el = (tag, cls, attrs = {}, kids = []) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids);
  return e;
};
const iconBtn = (cls, label, icon) => {
  const b = el('button', cls, { type: 'button', 'aria-label': label });
  b.innerHTML = icon;
  return b;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const srcset = (base, widths) => widths.map((w) => `${base}-${w}.webp ${w}w`).join(', ');
const image = ([base, height], sizes, widths, alt = '') =>
  el('img', '', { src: `${base}-${widths.at(-2) ?? widths[0]}.webp`, srcset: srcset(base, widths), sizes, width: 832, height, alt, decoding: 'async' });
const ready = (img) => img.decode().catch(() => {});
const prefetch = (shot, sizes, widths) => {
  if (!shot) return;
  const img = new Image();
  img.sizes = sizes;
  img.srcset = srcset(shot[0], widths);
};
// Znovu spustí CSS animaci „skenovací“ linky přes element
const scan = (node) => {
  node.removeAttribute('data-scan');
  void node.offsetWidth;
  node.setAttribute('data-scan', '');
};

const root = document.getElementById('karusel');
if (root) {
  fetch('/karusel/data.json')
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
    .then((data) => init(root, data))
    .catch(() => {}); // bez dat zůstane statický první snímek
}

function init(root, data) {
  const { modelky, outfity, snimky, pozy } = data;
  // Názvy z dat jsou česky, na cizojazyčné stránce je přeložíme jednou při startu
  modelky.forEach((m) => { m.postava = t(m.postava); });
  outfity.forEach((o) => { o.nazev = t(o.nazev); });
  pozy.forEach((x) => { x.nazev = t(x.nazev); });
  const W = data.sirky;
  const WT = [200, ...data.sirky];
  const stage = root.querySelector('.kz-stage');
  const controls = root.querySelector('.kz-controls');
  const live = root.querySelector('.kz-live');

  const modelka = (id) => modelky.find((m) => m.id === id);
  const outfit = (id) => outfity.find((o) => o.id === id);
  const poza = (p) => pozy.find((x) => x.id === p)?.nazev ?? '';
  // Chybějící snímek (vyřazený kontrolou kvality) nahradí jiná póza téhož outfitu
  const shotOf = (m, o, p) => snimky[`${m}|${o}|${p}`] ?? pozy.map((x) => snimky[`${m}|${o}|${x.id}`]).find(Boolean);
  const altOf = (m, o, p) => t('AI modelka {jmeno}, postava {postava}: {nazev}, póza {poza}', { jmeno: modelka(m).jmeno, postava: modelka(m).postava, nazev: outfit(o).nazev, poza: poza(p) });
  const cycle = (list, cur, dir = 1) => list[(list.indexOf(cur) + dir + list.length) % list.length];
  const poseIds = pozy.map((x) => x.id);
  const modelIds = modelky.map((m) => m.id);
  const outfitIds = outfity.map((o) => o.id);

  const params = new URLSearchParams(location.search);
  const variant = VARIANTS[params.get('karusel')] ? params.get('karusel') : root.dataset.variant;
  root.dataset.variant = variant;

  // ===== Společné ovládací prvky =====

  // Výměna snímku ve vrstvách: nový se načte, dekóduje a teprve pak naběhne s efektem
  const swapper = (layers, host) => {
    let seq = 0;
    let loadTimer;
    return async (img, fx) => {
      const my = ++seq;
      clearTimeout(loadTimer);
      loadTimer = setTimeout(() => host.setAttribute('data-loading', ''), 220);
      await ready(img);
      if (my !== seq) return false;
      clearTimeout(loadTimer);
      host.removeAttribute('data-loading');
      const old = [...layers.children];
      const layer = el('div', 'kz-layer', { 'data-fx': reduced ? 'none' : fx }, [img]);
      layers.append(layer);
      if (fx === 'dress' && !reduced) scan(host);
      const done = () => old.forEach((o) => o.remove());
      if (reduced) done();
      else layer.addEventListener('animationend', done, { once: true });
      return true;
    };
  };

  const outfitPicker = (onPick) => {
    const strip = el('div', 'kz-strip', { role: 'group', 'aria-label': t('Oblečení') });
    const buttons = outfity.map((o) => {
      const b = el('button', 'kz-chip', { type: 'button', 'aria-pressed': 'false', 'aria-label': t('Oblečení: {nazev}', { nazev: o.nazev }), title: o.nazev, 'data-id': o.id });
      o.kusy.forEach((url, i) => b.append(el('img', i ? 'kz-chip__second' : '', { src: url, width: 240, height: 240, alt: '', loading: 'lazy', decoding: 'async' })));
      b.addEventListener('click', () => onPick(o.id));
      return b;
    });
    strip.append(...buttons);
    const wrap = el('div', 'kz-pick', {}, [
      el('p', 'kz-label', {}, [el('span', 'kz-label__dot', { 'aria-hidden': 'true' }), el('span', '', {}, [t('Vyberte oblečení')]), el('span', 'kz-label__hint', {}, [t('vaše fotka → AI modelka')])]),
      strip,
    ]);
    const setActive = (id) => buttons.forEach((b) => {
      const on = b.dataset.id === id;
      b.setAttribute('aria-pressed', on);
      // Na mobilu je pás posuvný: vybraný kus držíme na očích (jen vodorovně, stránka neposkočí)
      if (on && strip.scrollWidth > strip.clientWidth) {
        strip.scrollTo({ left: b.offsetLeft - strip.clientWidth / 2 + b.offsetWidth / 2, behavior: reduced ? 'auto' : 'smooth' });
      }
    });
    return { el: wrap, buttons, setActive, find: (id) => buttons.find((b) => b.dataset.id === id) };
  };

  const modelRail = (onPick) => {
    const rail = el('div', 'kz-rail', { role: 'group', 'aria-label': t('Modelka') });
    const buttons = modelky.map((m) => {
      const b = el('button', 'kz-avatar', { type: 'button', 'aria-pressed': 'false', 'aria-label': t('Modelka {jmeno}, postava {postava}', { jmeno: m.jmeno, postava: m.postava }), 'data-id': m.id, 'data-name': m.jmeno });
      b.append(el('img', '', { src: `${m.zaklad[1][0]}-200.webp`, width: 200, height: 296, alt: '', decoding: 'async' }));
      b.addEventListener('click', () => onPick(m.id));
      return b;
    });
    rail.append(...buttons);
    const setActive = (id) => buttons.forEach((b) => b.setAttribute('aria-pressed', b.dataset.id === id));
    return { el: rail, buttons, setActive, find: (id) => buttons.find((b) => b.dataset.id === id) };
  };

  const posePill = (onStep) => {
    const label = el('span', 'kz-pose__label');
    const prev = iconBtn('kz-pose__btn', t('Předchozí póza'), ICON.prev);
    const next = iconBtn('kz-pose__btn', t('Další póza'), ICON.next);
    prev.addEventListener('click', () => onStep(-1));
    next.addEventListener('click', () => onStep(1));
    const dots = el('span', 'kz-pose__dots', { 'aria-hidden': 'true' }, poseIds.map(() => el('i')));
    const pill = el('div', 'kz-pose', { role: 'group', 'aria-label': t('Póza') }, [prev, el('span', 'kz-pose__mid', {}, [label, dots]), next]);
    const set = (p) => {
      label.textContent = poza(p);
      [...dots.children].forEach((d, i) => d.toggleAttribute('data-on', poseIds[i] === p));
    };
    return { el: pill, set };
  };

  const inputCard = () => {
    const thumbs = el('span', 'kz-card__thumbs');
    const card = el('div', 'kz-card', {}, [el('span', 'kz-card__label', {}, [t('Vaše fotka')]), thumbs]);
    const set = (o) => {
      thumbs.replaceChildren(...outfit(o).kusy.map((url) => el('img', '', { src: url, width: 240, height: 240, alt: '', decoding: 'async' })));
      if (!reduced) scan(card);
    };
    return { el: card, set };
  };

  const tag = () => {
    const node = el('span', 'kz-tag', { 'aria-hidden': 'true' });
    return { el: node, set: (m) => { node.textContent = `${modelka(m).jmeno} · ${modelka(m).postava}`; } };
  };

  // Vodorovné tažení po snímku (swipe) přepíná pózu
  const swipePose = (target, onStep) => {
    let x0 = null;
    target.addEventListener('pointerdown', (e) => { if (!e.target.closest('button')) x0 = e.clientX; });
    target.addEventListener('pointerup', (e) => {
      if (x0 === null) return;
      const dx = e.clientX - x0;
      x0 = null;
      if (Math.abs(dx) > 36) onStep(dx < 0 ? 1 : -1);
    });
    target.addEventListener('pointercancel', () => { x0 = null; });
  };

  // Ukázkové přehrávání: „duch“ kurzoru sám kliká, dokud návštěvník nezačne – pak zmizí
  const autoplay = (nextButton, afterClick) => {
    if (reduced) return () => {};
    const ghost = el('span', 'kz-ghost', { 'aria-hidden': 'true' });
    ghost.innerHTML = ICON.hand;
    root.append(ghost);
    let stopped = false;
    let paused = false;
    let visible = true;
    let n = 0;
    let timer;
    const stop = () => {
      stopped = true;
      clearTimeout(timer);
      ghost.remove();
      root.removeAttribute('data-demo');
    };
    const tick = async () => {
      if (stopped) return;
      if (paused || !visible || document.hidden) { timer = setTimeout(tick, 500); return; }
      if (n >= MAX_STEPS) return stop();
      const btn = nextButton(n++);
      const r = btn.getBoundingClientRect();
      const R = root.getBoundingClientRect();
      ghost.style.transform = `translate(${r.left - R.left + r.width * 0.5}px, ${r.top - R.top + r.height * 0.55}px)`;
      ghost.setAttribute('data-on', '');
      await wait(800);
      if (stopped || paused) { timer = setTimeout(tick, 500); return; }
      ghost.setAttribute('data-press', '');
      await wait(160);
      ghost.removeAttribute('data-press');
      btn.click();
      afterClick?.();
      timer = setTimeout(tick, STEP_MS);
    };
    root.setAttribute('data-demo', '');
    ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((ev) => root.addEventListener(ev, (e) => { if (e.isTrusted) stop(); }, { passive: true }));
    root.addEventListener('mouseenter', () => { paused = true; ghost.removeAttribute('data-on'); });
    root.addEventListener('mouseleave', () => { paused = false; });
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(root);
    const r = stage.getBoundingClientRect();
    const R = root.getBoundingClientRect();
    ghost.style.transform = `translate(${r.width * 0.55}px, ${r.top - R.top + r.height * 0.6}px)`;
    timer = setTimeout(tick, 1600);
    return stop;
  };

  const footer = () => {
    const pieces = new Set(outfity.flatMap((o) => o.kusy)).size;
    root.append(el('p', 'kz-count', {}, [t('{n} kombinací z {k} obyčejných fotek produktů', { n: modelky.length * outfity.length * pozy.length, k: pieces })]));
    if (location.hostname === 'www.bezmodelky.cz' && !params.has('karusel')) return;
    // Přepínač variant jen pro náhled (Vercel preview, lokálně nebo s ?karusel=)
    root.append(el('nav', 'kz-switch', { 'aria-label': 'Varianta karuselu (jen náhled)' }, [
      'Náhled varianty:',
      ...Object.entries(VARIANTS).map(([k, name]) => el('a', '', { href: `?karusel=${k}`, 'aria-current': k === variant ? 'true' : 'false' }, [`${k.toUpperCase()} ${name}`])),
    ]));
  };

  const keys = (onStep) => root.addEventListener('keydown', (e) => {
    const dir = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!dir || e.target.matches('input')) return;
    e.preventDefault();
    onStep(dir);
  });

  ({ a: mountA, b: mountB, c: mountC })[variant]();
  root.setAttribute('data-ready', '');

  // ===== A: Šatna =====
  function mountA() {
    const st = { ...START };
    const layers = stage.querySelector('.kz-layers');
    const swap = swapper(layers, stage);
    const name = tag();
    const rail = modelRail((m) => { if (m !== st.m) { st.m = m; show('fade'); } });
    const pose = posePill((dir) => { st.p = cycle(poseIds, st.p, dir); show(dir > 0 ? 'slide-l' : 'slide-r'); });
    const card = inputCard();
    const picker = outfitPicker((o) => { if (o !== st.o) { st.o = o; show('dress'); } });
    stage.append(name.el, rail.el, pose.el, card.el);
    controls.append(picker.el);
    footer();

    const sync = () => {
      name.set(st.m);
      rail.setActive(st.m);
      pose.set(st.p);
      card.set(st.o);
      picker.setActive(st.o);
    };
    const show = async (fx) => {
      sync();
      const alt = altOf(st.m, st.o, st.p);
      live.textContent = alt;
      await swap(image(shotOf(st.m, st.o, st.p), SIZES, W, alt), fx);
      prefetch(shotOf(st.m, st.o, cycle(poseIds, st.p)), SIZES, W);
      prefetch(shotOf(st.m, cycle(outfitIds, st.o), st.p), SIZES, W);
    };
    sync();
    swipePose(stage, (dir) => pose.el.querySelectorAll('button')[dir > 0 ? 1 : 0].click());
    keys((dir) => pose.el.querySelectorAll('button')[dir > 0 ? 1 : 0].click());
    prefetch(shotOf(st.m, cycle(outfitIds, st.o), st.p), SIZES, W);
    // Každý třetí krok ukázky změní modelku, ostatní oblečení
    autoplay((n) => (n % 3 === 2 ? rail.find(cycle(modelIds, st.m)) : picker.find(cycle(outfitIds, st.o))));
  }

  // ===== B: Před/po =====
  function mountB() {
    const st = { ...START };
    const layers = stage.querySelector('.kz-layers');
    const after = layers.firstElementChild;
    after.classList.add('kz-after');
    const before = el('div', 'kz-layer kz-before');
    layers.prepend(before);
    stage.classList.add('kz-stage--compare');

    const range = el('input', 'kz-range', { type: 'range', min: 0, max: 100, value: 50, 'aria-label': t('Porovnání před a po: posuňte pro zobrazení oblečení na modelce') });
    const knob = el('span', 'kz-knob');
    knob.innerHTML = ICON.both;
    const handle = el('div', 'kz-handle', { 'aria-hidden': 'true' }, [knob, el('span', 'kz-bubble', {}, [t('Táhněte')])]);
    const labels = [el('span', 'kz-side kz-side--l', { 'aria-hidden': 'true' }, [t('AI modelka')]), el('span', 'kz-side kz-side--r', { 'aria-hidden': 'true' }, [t('S vaším oblečením')])];
    const rail = modelRail((m) => { if (m !== st.m) { st.m = m; show(); } });
    const pose = posePill((dir) => { st.p = cycle(poseIds, st.p, dir); show(); });
    const card = inputCard();
    const picker = outfitPicker((o) => { if (o !== st.o) { st.o = o; show(); } });
    stage.append(...labels, handle, range, rail.el, pose.el, card.el);
    controls.append(picker.el);
    footer();

    let anim = 0;
    const setPos = (v) => {
      stage.style.setProperty('--pos', `${v}%`);
      range.value = v;
    };
    // Plynulý pohyb posuvníku přes zadané body (ukázka, že se s ním dá hýbat)
    const sweep = async (points, ms) => {
      const my = ++anim;
      if (reduced) return setPos(points.at(-1));
      for (let i = 1; i < points.length; i++) {
        const [a, b] = [points[i - 1], points[i]];
        const t0 = performance.now();
        await new Promise((done) => {
          const frame = (t) => {
            if (my !== anim) return done();
            const k = Math.min(1, (t - t0) / ms);
            setPos(a + (b - a) * (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2));
            k < 1 ? requestAnimationFrame(frame) : done();
          };
          requestAnimationFrame(frame);
        });
        if (my !== anim) return;
      }
    };
    const userMove = (v) => {
      anim++;
      stage.setAttribute('data-touched', '');
      setPos(v);
    };
    range.addEventListener('input', () => userMove(+range.value));
    // Na počítači posuvník jde za myší i bez kliknutí
    stage.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || e.target.closest('button, .kz-card')) return;
      const r = stage.getBoundingClientRect();
      userMove(Math.round(Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100))));
    });

    let seq = 0;
    const show = async () => {
      const my = ++seq;
      rail.setActive(st.m);
      pose.set(st.p);
      card.set(st.o);
      picker.setActive(st.o);
      const alt = altOf(st.m, st.o, st.p);
      live.textContent = alt;
      const imgs = [
        image(modelka(st.m).zaklad[st.p] ?? modelka(st.m).zaklad[1], SIZES, W, t('AI modelka {jmeno} v tělovém body, póza {poza}', { jmeno: modelka(st.m).jmeno, poza: poza(st.p) })),
        image(shotOf(st.m, st.o, st.p), SIZES, W, alt),
      ];
      const loading = setTimeout(() => stage.setAttribute('data-loading', ''), 220);
      await Promise.all(imgs.map(ready));
      clearTimeout(loading);
      if (my !== seq) return;
      stage.removeAttribute('data-loading');
      before.replaceChildren(imgs[0]);
      after.replaceChildren(imgs[1]);
      if (!reduced) scan(stage);
      // Oblečení „naběhne“ zprava doleva a zastaví se uprostřed
      sweep([100, 12, 50], 650);
      prefetch(shotOf(st.m, cycle(outfitIds, st.o), st.p), SIZES, W);
    };

    rail.setActive(st.m);
    pose.set(st.p);
    card.set(st.o);
    picker.setActive(st.o);
    keys((dir) => userMove(Math.max(0, Math.min(100, +range.value + dir * 5))));
    // Zaklad se načte hned, aby první posun ukázal „před“
    const first = image(modelka(st.m).zaklad[st.p], SIZES, W, t('AI modelka {jmeno} v tělovém body, póza {poza}', { jmeno: modelka(st.m).jmeno, poza: poza(st.p) }));
    ready(first).then(() => {
      before.replaceChildren(first);
      wait(600).then(() => { if (!stage.hasAttribute('data-touched')) sweep([0, 80, 20, 50], 750); });
    });
    setPos(0);
    autoplay((n) => (n % 3 === 2 ? rail.find(cycle(modelIds, st.m)) : picker.find(cycle(outfitIds, st.o))));
  }

  // ===== C: Jedna fotka, šest modelek =====
  function mountC() {
    const st = { o: START.o };
    stage.querySelector('.kz-layers').remove();
    stage.classList.add('kz-stage--grid');

    const products = el('span', 'kz-c__products');
    const head = el('div', 'kz-c__head', {}, [
      el('span', 'kz-c__in', {}, [el('span', 'kz-c__cap', {}, [t('1 fotka produktu')]), products]),
      el('span', 'kz-c__arrow', { 'aria-hidden': 'true' }, ['→']),
      el('span', 'kz-c__out', {}, [el('strong', '', {}, [String(modelky.length)]), ` ${t('modelek,')}`, el('br'), t('různé postavy i prostředí')]),
    ]);
    const tiles = modelky.map((m, i) => {
      const layers = el('div', 'kz-layers');
      const b = el('button', 'kz-tile', { type: 'button', 'aria-label': t('Zvětšit: modelka {jmeno}, postava {postava}', { jmeno: m.jmeno, postava: m.postava }) }, [layers, el('span', 'kz-tile__name', { 'aria-hidden': 'true' }, [m.jmeno])]);
      b.addEventListener('click', () => openZoom(m.id, TILE_POSES[i]));
      return { m: m.id, p: TILE_POSES[i], b, swap: swapper(layers, b) };
    });
    const grid = el('div', 'kz-grid', {}, tiles.map((t) => t.b));
    stage.append(el('div', 'kz-c', {}, [head, grid]));

    const picker = outfitPicker((o) => { if (o !== st.o) { st.o = o; show(); } });
    controls.append(picker.el);
    footer();

    const show = () => {
      picker.setActive(st.o);
      products.replaceChildren(...outfit(st.o).kusy.map((url) => el('img', '', { src: url, width: 240, height: 240, alt: '', decoding: 'async' })));
      if (!reduced) scan(head);
      live.textContent = t('{nazev} na {n} AI modelkách', { nazev: outfit(st.o).nazev, n: modelky.length });
      // Postupné „oblékání“ dlaždic, jedna po druhé
      tiles.forEach((tile, i) => {
        const img = image(shotOf(tile.m, st.o, tile.p), TILE_SIZES, WT, altOf(tile.m, st.o, tile.p));
        wait(reduced ? 0 : i * 110).then(() => tile.swap(img, 'dress'));
      });
      tiles.forEach((tile) => prefetch(shotOf(tile.m, cycle(outfitIds, st.o), tile.p), TILE_SIZES, WT));
    };

    // Zvětšení jedné modelky přes celou scénu, s přepínáním póz
    const zoomLayers = el('div', 'kz-layers');
    const zoomName = tag();
    const zoomSt = { m: null, p: 1 };
    const zoomPose = posePill((dir) => { zoomSt.p = cycle(poseIds, zoomSt.p, dir); zoomShow(dir > 0 ? 'slide-l' : 'slide-r'); });
    const close = el('button', 'kz-close', { type: 'button' }, [t('← Všech {n} modelek', { n: modelky.length })]);
    const zoom = el('div', 'kz-zoom', { hidden: '' }, [zoomLayers, zoomName.el, zoomPose.el, close]);
    const zoomSwap = swapper(zoomLayers, zoom);
    stage.append(zoom);
    const zoomShow = (fx) => {
      zoomName.set(zoomSt.m);
      zoomPose.set(zoomSt.p);
      const alt = altOf(zoomSt.m, st.o, zoomSt.p);
      live.textContent = alt;
      return zoomSwap(image(shotOf(zoomSt.m, st.o, zoomSt.p), SIZES, W, alt), fx);
    };
    let opener;
    const openZoom = (m, p) => {
      opener = document.activeElement;
      Object.assign(zoomSt, { m, p });
      zoomLayers.replaceChildren();
      zoom.hidden = false;
      zoomShow('fade');
      close.focus({ preventScroll: true });
    };
    const closeZoom = () => {
      zoom.hidden = true;
      opener?.focus?.({ preventScroll: true });
    };
    close.addEventListener('click', closeZoom);
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !zoom.hidden) closeZoom(); });
    swipePose(zoom, (dir) => zoomPose.el.querySelectorAll('button')[dir > 0 ? 1 : 0].click());
    keys((dir) => {
      if (!zoom.hidden) zoomPose.el.querySelectorAll('button')[dir > 0 ? 1 : 0].click();
      else picker.find(cycle(outfitIds, st.o, dir)).click();
    });
    // Při výběru jiného oblečení se zvětšení zavře, ať je vidět všech šest
    picker.buttons.forEach((b) => b.addEventListener('click', () => { if (!zoom.hidden) closeZoom(); }));

    show();
    autoplay(() => picker.find(cycle(outfitIds, st.o)));
  }
}
