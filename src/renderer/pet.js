import { drawSprite } from './sprites.js';
const canvas = document.querySelector('#character'), bubble = document.querySelector('#bubble'), home = document.querySelector('#home');
let settings = await window.pet.getSettings(), action = 'idle', bubbleTimer, pressed, dragging = false, ignored = false;
function say(text) {
  if (!text) return;
  bubble.textContent = text; bubble.classList.add('visible'); clearTimeout(bubbleTimer); bubbleTimer = setTimeout(() => bubble.classList.remove('visible'), 6500);
}
function render() {
  document.body.classList.toggle('quiet', settings.quiet);
  drawSprite(canvas, settings.appearance, action).catch(error => say(error.message));
}
function hit(event) {
  if (event.target === home || home.contains(event.target)) return true;
  const box = canvas.getBoundingClientRect();
  const x = Math.floor((event.clientX - box.left) / box.width * canvas.width), y = Math.floor((event.clientY - box.top) / box.height * canvas.height);
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return false;
  return canvas.getContext('2d').getImageData(x, y, 1, 1).data[3] > 24;
}
function mouse(ignore) { if (ignore !== ignored) { ignored = ignore; window.pet.mouse(ignore); } }
document.addEventListener('mousemove', event => {
  if (pressed) {
    if (!dragging && Math.hypot(event.screenX - pressed.x, event.screenY - pressed.y) > 6) { dragging = true; window.pet.drag('start'); }
    mouse(false); return;
  }
  mouse(!hit(event));
});
canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0 || !hit(event)) return;
  pressed = { x: event.screenX, y: event.screenY }; canvas.setPointerCapture(event.pointerId); mouse(false);
});
canvas.addEventListener('pointerup', async event => {
  if (event.button !== 0 || !pressed) return;
  const didDrag = dragging; pressed = null; dragging = false; window.pet.drag('stop');
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  if (!didDrag) { const result = await window.pet.launch(); if (!result.ok && result.message) say(result.message); }
});
function cancelDrag() { pressed = null; dragging = false; window.pet.drag('stop'); }
canvas.addEventListener('pointercancel', cancelDrag); window.addEventListener('blur', cancelDrag);
document.addEventListener('contextmenu', event => { event.preventDefault(); if (hit(event)) window.pet.menu(); });
canvas.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); window.pet.launch(); } if (event.key === 'ContextMenu') window.pet.menu(); });
home.addEventListener('click', () => window.pet.panel('home'));
document.addEventListener('mouseleave', () => { if (!pressed) mouse(true); });
window.pet.onUpdate(update => {
  if (update.settings) settings = update.settings;
  if (update.action) action = update.action;
  if (update.message) say(update.message);
  render();
});
render(); say('你好呀，我是玲珑。右键来认识一下？');
