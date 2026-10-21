// Formulář „Fotka zdarma“: kontrola kontaktu, příprava fotek v prohlížeči a bezpečné nahrání.
const MAX_FILES = 3;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_EDGE = 3000; // delší strana po zmenšení (px)
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
const WEB3FORMS_KEY = '6bcb1810-6e47-4daf-9442-bffd1827d46a';

const form = document.getElementById('upload-form');
if (form) init(form);

function init(form) {
  const $ = (id) => document.getElementById(id);
  const email = $('email');
  const phone = $('phone');
  const input = $('photos');
  const dropzone = $('dropzone');
  const hint = $('dropzone-hint');
  const previews = $('previews');
  const status = $('form-status');
  const submit = form.querySelector('button[type="submit"]');
  const renderedAt = Date.now();
  let files = [];

  const validEmail = () => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email.value.trim());
  const validPhone = () => /^\+?[0-9]{9,15}$/.test(phone.value.replace(/[\s\-().]/g, ''));

  const setStatus = (type, text) => {
    status.textContent = text;
    status.className = 'rounded-xl p-4 text-sm font-medium ' +
      (type === 'error' ? 'bg-red-50 text-red-800' : 'bg-accent/10 text-accent-dark');
    if (!text) status.className = 'hidden';
  };

  // Nahrání fotek je odemčené až po vyplnění platného e-mailu a telefonu
  const updateLock = () => {
    const unlocked = validEmail() && validPhone();
    input.disabled = !unlocked || files.length >= MAX_FILES;
    dropzone.toggleAttribute('data-locked', !unlocked);
    hint.textContent = !unlocked
      ? 'Nejdřív vyplňte e-mail a telefon.'
      : files.length >= MAX_FILES
        ? 'Máte vybrané maximum 3 fotek.'
        : 'JPG, PNG nebo WebP. Větší fotky automaticky zmenšíme na max. 5 MB.';
  };
  email.addEventListener('input', updateLock);
  phone.addEventListener('input', updateLock);
  updateLock();

  const renderPreviews = () => {
    previews.replaceChildren(...files.map((item, i) => {
      const li = document.createElement('li');
      li.className = 'relative overflow-hidden rounded-xl border border-line bg-sand';
      const img = document.createElement('img');
      img.src = item.url;
      img.alt = `Vybraná fotka ${i + 1}`;
      img.className = 'aspect-square w-full object-cover';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'absolute top-1.5 right-1.5 grid h-7 w-7 place-items-center rounded-full bg-white/90 text-ink shadow';
      btn.setAttribute('aria-label', `Odebrat fotku ${i + 1}`);
      btn.textContent = '×';
      btn.addEventListener('click', () => {
        URL.revokeObjectURL(item.url);
        files.splice(i, 1);
        renderPreviews();
        updateLock();
      });
      li.append(img, btn);
      return li;
    }));
  };

  const addFiles = async (list) => {
    setStatus(null, '');
    for (const file of list) {
      if (files.length >= MAX_FILES) {
        setStatus('error', 'Nahrát můžete maximálně 3 fotky jednoho produktu.');
        break;
      }
      try {
        const blob = await prepareImage(file);
        files.push({ blob, url: URL.createObjectURL(blob) });
      } catch (err) {
        setStatus('error', err.message);
      }
    }
    renderPreviews();
    updateLock();
  };

  input.addEventListener('change', () => {
    addFiles([...input.files]);
    input.value = '';
  });
  ['dragenter', 'dragover'].forEach((ev) => dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    if (!input.disabled) dropzone.setAttribute('data-dragover', '');
  }));
  ['dragleave', 'drop'].forEach((ev) => dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.removeAttribute('data-dragover');
    if (ev === 'drop' && !input.disabled) addFiles([...e.dataTransfer.files]);
  }));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validEmail()) return fail('Zadejte prosím platný e-mail.', email);
    if (!validPhone()) return fail('Zadejte prosím platné telefonní číslo (např. +420 777 123 456).', phone);
    if (!files.length) return fail('Nahrajte prosím alespoň jednu fotku produktu.', input);

    const label = submit.textContent;
    submit.disabled = true;
    const data = Object.fromEntries(new FormData(form));
    const guard = { hp: data.website || '', t: renderedAt };
    const leadId = crypto.randomUUID();

    try {
      const { put } = await import('@vercel/blob/client');
      const pathnames = [];
      for (const [i, item] of files.entries()) {
        submit.textContent = `Nahrávám fotku ${i + 1} z ${files.length}…`;
        const pathname = `uploads/${leadId}/${i + 1}.jpg`;
        const token = await getUploadToken(pathname, { email: data.email, phone: data.phone, ...guard });
        const result = await put(pathname, item.blob, { access: 'private', token, contentType: 'image/jpeg' });
        pathnames.push(result.pathname);
      }

      submit.textContent = 'Odesílám…';
      const res = await fetch('/api/poptavka', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, ...guard, leadId, files: pathnames }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Odeslání se nepovedlo.');

      // E-mailová notifikace (poptávka je už bezpečně uložená, případná chyba zde nevadí)
      await fetch('https://api.web3forms.com/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          access_key: WEB3FORMS_KEY,
          subject: 'Nová žádost o fotku zdarma – BezModelky.cz',
          from_name: 'BezModelky.cz',
          replyto: data.email,
          'E-mail': data.email,
          Telefon: data.phone,
          Jméno: data.name,
          'E-shop': data.eshop,
          Prostředí: data.style,
          Modelka: data.model,
          Poznámka: data.note,
          Fotky: body.links.join('\n'),
        }),
      }).catch(() => {});

      form.classList.add('hidden');
      const success = $('upload-success');
      success.classList.remove('hidden');
      success.focus();
    } catch (err) {
      fail(err?.message && !/fetch|network/i.test(err.message)
        ? cleanError(err.message)
        : 'Nahrání se nepovedlo. Zkontrolujte připojení a zkuste to znovu.');
    } finally {
      submit.disabled = false;
      submit.textContent = label;
    }
  });

  function fail(message, field) {
    setStatus('error', message);
    field?.focus();
  }
}

// Krátkodobý token pro nahrání jedné fotky (server ověří kontakt a limity)
async function getUploadToken(pathname, payload) {
  const res = await fetch('/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'blob.generate-client-token',
      payload: { pathname, clientPayload: JSON.stringify(payload), multipart: false },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.clientToken) throw new Error(body.error || 'Nahrání se nepovedlo, zkuste to prosím znovu.');
  return body.clientToken;
}

// Chybové hlášky z nahrávací knihovny mají prefix, uživateli ukážeme jen naši zprávu
function cleanError(message) {
  const match = message.match(/"error"\s*:\s*"([^"]+)"/);
  return (match ? match[1] : message.replace(/^Vercel Blob:\s*/, '')).slice(0, 200);
}

// Fotku překreslí do JPEG: odstraní metadata (GPS apod.), otočí podle EXIF a zmenší pod 5 MB.
async function prepareImage(file) {
  const isImage = ALLOWED.includes(file.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);
  if (!isImage) throw new Error(`„${file.name}“ není fotka. Použijte JPG, PNG nebo WebP.`);

  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(`Fotku „${file.name}“ se nepodařilo načíst. Zkuste ji uložit jako JPG.`);
  }

  let scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  let quality = 0.9;
  for (let attempt = 0; attempt < 6; attempt++) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // průhledné PNG dostane bílé pozadí
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob && blob.size <= MAX_BYTES) {
      bitmap.close();
      return blob;
    }
    quality = Math.max(0.6, quality - 0.1);
    scale *= 0.85;
  }
  bitmap.close();
  throw new Error(`Fotka „${file.name}“ je příliš velká. Zkuste menší rozlišení.`);
}
