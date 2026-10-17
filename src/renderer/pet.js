import { drawSprite } from './sprites.js';
const canvas = document.querySelector('#character'), bubble = document.querySelector('#bubble'), home = document.querySelector('#home');
let settings = await window.pet.getSettings(), action = 'idle', bubbleTimer, pressed, dragging = false, ignored = false;
let activity = { state: 'unknown', label: '正在读取状态', message: '正在查看 Codex 的本机工作状态。', action: 'idle' };
let manualAction = null, transientMessage = null;
function layout() {
  // The bubble, padded character stage and name occupy separate flow rows.
  // Measure wrapped text instead of guessing how much headroom it needs.
  const reserved = bubble.offsetHeight + home.offsetHeight + 6 + 24 + 24;
  const size = Math.max(1, Math.min(320 * settings.scale, innerWidth, innerHeight - reserved));
  document.documentElement.style.setProperty('--sprite-size', size + 'px');
}
function renderBubble() {
  const label = transientMessage ? 'ChatGPT' : activity.label.includes('Codex') ? activity.label : 'Codex · ' + activity.label;
  const message = transientMessage || activity.message;
  if (bubble.querySelector('.bubble-label').textContent !== label) bubble.querySelector('.bubble-label').textContent = label;
  if (bubble.querySelector('.bubble-message').textContent !== message) bubble.querySelector('.bubble-message').textContent = message;
  bubble.classList.add('visible');
  bubble.dataset.state = activity.state;
  document.body.dataset.state = activity.state;
  home.title = '打开 ChatGPT 的小窝 · Codex ' + activity.label;
  layout();
}
function say(text) {
  if (!text) return;
  transientMessage = text; renderBubble(); clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => { transientMessage = null; renderBubble(); }, 6500);
}
function render() {
  action = manualAction || activity.action || 'idle';
  document.body.classList.toggle('quiet', settings.quiet);
  drawSprite(canvas, settings.appearance, action).catch(error => say(error.message));
  renderBubble();
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
  if (update.activity) activity = update.activity;
  if (update.action) manualAction = update.action;
  if (update.resumeActivity) { manualAction = null; transientMessage = null; clearTimeout(bubbleTimer); }
  if (update.message) say(update.message);
  render();
});
activity = await window.pet.activity();
new ResizeObserver(layout).observe(bubble);
window.addEventListener('resize', layout);
render();
