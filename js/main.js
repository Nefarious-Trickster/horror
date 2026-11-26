// Entry point: title menu and level loading.
import { Game } from './engine/game.js';
import { testRoom } from './levels/testroom.js';
import { loadCreatureModel } from './levels/common.js';

const game = new Game();
window.__game = game;
const $ = (id) => document.getElementById(id);
const params = game.params;

const LEVELS = {
  intro: () => import('./levels/intro.js').then((m) => m.intro),
  chapter1: () => import('./levels/chapter1.js').then((m) => m.chapter1),
  chapter2: () => import('./levels/chapter2.js').then((m) => m.chapter2),
  chapter3: () => import('./levels/chapter3.js').then((m) => m.chapter3),
  chapter4: () => import('./levels/chapter4.js').then((m) => m.chapter4),
  chapter5: () => import('./levels/chapter5.js').then((m) => m.chapter5),
  epilogue: () => import('./levels/epilogue.js').then((m) => m.epilogue),
  test: async () => testRoom,
};

let progress = 0;
game.onProgress = (p) => { progress = p; $('bar').style.width = (p * 100).toFixed(0) + '%'; };
loadCreatureModel(game.onProgress).then(() => { $('menu').classList.add('ready'); $('bar').parentElement.classList.add('done'); })
  .catch((e) => { $('status').textContent = 'Could not load the creature: ' + e.message; });

async function start(name, opts) {
  $('menu').classList.add('gone');
  game.ui.setFade(1);
  const fn = await LEVELS[name]();
  await game.load(fn, opts);
  if (!game.level.ownFade) game.ui.fadeTo(0, 1.2);
  game.input.lock();
  window.__ready = true;
}
for (const b of document.querySelectorAll('#menu [data-level]')) b.addEventListener('click', () => start(b.dataset.level));
// the epilogue button appears once you have reached an ending
try { const sv = JSON.parse(localStorage.getItem('the-tall-one/save/v1')) || {}; const eb = document.querySelector('#menu [data-level="epilogue"]'); if (eb) eb.hidden = !sv.ending; } catch { /* no storage */ }
$('settingsBtn').addEventListener('click', () => game.ui.openSettings(game.settings));

// direct entry for testing: ?level=intro|test (&noui hides the menu instantly)
if (params.has('level') || params.has('act') || params.has('cam')) {
  start(params.get('level') || 'test', { checkpoint: params.get('cp') });
}
