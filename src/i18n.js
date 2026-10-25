// Překlady textů ve skriptech: klíčem je český text, slovník pro jazyk stránky vloží build
// do <script type="application/json" id="i18n">. Na české stránce slovník není a vrací se klíč.
const dict = (() => {
  try {
    return JSON.parse(document.getElementById('i18n')?.textContent || '{}');
  } catch {
    return {};
  }
})();

export const lang = document.documentElement.lang || 'cs';

// t('Nahrávám fotku {i} z {n}…', { i: 1, n: 3 })
export const t = (text, vars = {}) => (dict[text] ?? text).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
