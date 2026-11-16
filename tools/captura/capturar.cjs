// uso: node tools/captura/capturar.cjs <tela> [--largura=390] [--altura=667] [--cheia] [--toque]
// Telas: ver tools/captura/abre-tela.js. Grava tools/captura/saida/<tela>-<largura>.png.
// Sempre com o estado fictício de estado-ficticio.js — nunca dado real.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const raiz = path.join(__dirname, '..', '..');
const args = process.argv.slice(2);
const tela = args.find((a) => !a.startsWith('--')) || 'lista';
const opt = (nome, padrao) => { const a = args.find((x) => x.startsWith('--' + nome + '=')); return a ? a.split('=')[1] : padrao; };
const largura = Number(opt('largura', 390));
const altura = Number(opt('altura', args.includes('--cheia') ? 3200 : 667));

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'caderno-captura-'));
['painel-core.js', 'styles.css', 'icon.svg'].forEach((f) => fs.copyFileSync(path.join(raiz, f), path.join(work, f)));

const ler = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const gravaEstado = ler('estado-ficticio.js') + `
;(function () {
  var d = new Date();
  var hoje = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  localStorage.setItem('wardBookData_v16', JSON.stringify(estadoFicticio(hoje)));
  localStorage.setItem('sb-x-auth-token', 'ficticio-ficticio-ficticio-ficticio');
})();`;

let html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');
const MARCA = '<script src="painel-core.js"></script>';
if (!html.includes(MARCA)) throw new Error('index.html mudou: não achei ' + MARCA);
html = html.replace(MARCA, '<script>' + gravaEstado + '</script>\n' + MARCA);
html = html.replace('</body>', '<script>' + ler('abre-tela.js') + '</script>\n</body>');
fs.writeFileSync(path.join(work, 'index.html'), html);
fs.writeFileSync(path.join(work, 'wrapper.html'),
  '<!doctype html><body style="margin:0;background:#777"><iframe src="index.html#' + tela +
  '" style="width:' + largura + 'px;height:' + altura + 'px;border:0;display:block"></iframe></body>');

const saida = path.join(__dirname, 'saida');
fs.mkdirSync(saida, { recursive: true });
const png = path.join(saida, tela.replace(/:/g, '-') + '-' + largura + '.png');
const edge = process.env.CAPTURA_BROWSER || ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
if (!edge) throw new Error('Edge não encontrado; defina CAPTURA_BROWSER com o caminho do navegador');
// --toque: aparelho sem hover e com ponteiro grosso, como o celular. Sem ele o Edge se
// apresenta como computador e (hover:hover) esconde os botões que só aparecem no hover.
const toque = args.includes('--toque')
  ? ['--blink-settings=primaryHoverType=1,availableHoverTypes=1,primaryPointerType=2,availablePointerTypes=2']
  : [];
execFileSync(edge, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--virtual-time-budget=4000', ...toque,
  '--user-data-dir=' + path.join(work, 'perfil'), '--window-size=' + Math.max(largura, 600) + ',' + altura,
  '--screenshot=' + png, 'file:///' + path.join(work, 'wrapper.html').replace(/\\/g, '/')],
  { stdio: 'pipe', timeout: 60000 });
console.log(png);
