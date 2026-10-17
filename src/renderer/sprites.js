export const states = ['idle', 'wave', 'crouch', 'eat', 'headpat', 'sleep', 'busy', 'success'];
const images = new Map();
export function loadSheet(appearance, working = false) {
  const name = (appearance === 'mature' ? 'mature' : 'cute') + (working ? '-working' : '');
  if (!images.has(name)) images.set(name, new Promise((resolve, reject) => {
    const image = new Image(); image.onload = () => resolve(image); image.onerror = () => { images.delete(name); reject(new Error('角色图片加载失败')); }; image.src = `../../assets/${name}.png`;
  }));
  return images.get(name);
}
export async function drawSprite(canvas, appearance = 'cute', action = 'idle') {
  const request = `${appearance}:${action}`; canvas.dataset.request = request;
  const working = action === 'busy';
  const image = await loadSheet(appearance, working);
  if (canvas.dataset.request !== request) return;
  const index = working ? 0 : Math.max(0, states.indexOf(action));
  const sw = image.width / (working ? 1 : 4), sh = image.height / (working ? 1 : 2);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const scale = Math.min(canvas.width / sw, canvas.height / sh);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, (index % 4) * sw, Math.floor(index / 4) * sh, sw, sh, (canvas.width - sw * scale) / 2, canvas.height - sh * scale, sw * scale, sh * scale);
  canvas.dataset.action = action;
  canvas.dataset.asset = (appearance === 'mature' ? 'mature' : 'cute') + (working ? '-working.png' : '.png');
}
