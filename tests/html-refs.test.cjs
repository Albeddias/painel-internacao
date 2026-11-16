const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// O script liga eventos com getElementById(...).addEventListener e, na tela do paciente,
// com querySelector('.classe'). Se o elemento sai do HTML e a linha fica, o script para
// ali: o app abre em branco. Este teste lê o arquivo como texto e confere as duas pontas.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.slice(html.lastIndexOf('<script>'));

const SELECTOR_CALL = /(?:querySelector(?:All)?|closest|matches|setupCollapsibleSection\(\s*\w+\s*,|enableListDrag\(\s*\w+\s*,)\s*\(?\s*(['"`])((?:(?!\1).)*)\1/g;
const selectors = [...script.matchAll(SELECTOR_CALL)].map((m) => m[2]);

test('todo id procurado pelo script existe no HTML', () => {
  const ids = new Set([...html.matchAll(/\bid="([^"${}]+)"/g)].map((m) => m[1]));
  const refs = new Set([...script.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]));
  selectors.forEach((s) => { for (const m of s.matchAll(/#([A-Za-z][\w-]*)/g)) refs.add(m[1]); });
  assert.ok(refs.size > 50, 'a extração de ids parou de funcionar');
  assert.deepStrictEqual([...refs].filter((id) => !ids.has(id)), []);
});

test('toda classe procurada pelo script existe em algum class="…"', () => {
  const classes = new Set();
  for (const m of html.matchAll(/class(?:Name)?\s*=\s*(["'`])((?:(?!\1)[\s\S])*)\1/g)) {
    m[2].replace(/\$\{[^}]*\}/g, ' ').split(/\s+/).filter(Boolean).forEach((c) => classes.add(c));
  }
  for (const m of script.matchAll(/classList\.(?:add|toggle|remove)\(([^)]*)\)/g)) {
    for (const s of m[1].matchAll(/['"]([^'"]+)['"]/g)) classes.add(s[1]);
  }
  const refs = new Set();
  selectors.forEach((s) => {
    const limpo = s.replace(/\$\{[^}]*\}/g, ' ').replace(/\[[^\]]*\]/g, ' ');
    for (const m of limpo.matchAll(/\.([A-Za-z][\w-]*)/g)) refs.add(m[1]);
  });
  assert.ok(refs.size > 50, 'a extração de classes parou de funcionar');
  assert.deepStrictEqual([...refs].filter((c) => !classes.has(c)), []);
});
