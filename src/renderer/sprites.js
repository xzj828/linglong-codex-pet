export const states = ['idle', 'wave', 'crouch', 'eat', 'headpat', 'sleep', 'busy', 'success'];
const images = new Map();
export function loadSheet(appearance, pose = '') {
  const name = (appearance === 'mature' ? 'mature' : 'cute') + pose;
  if (!images.has(name)) images.set(name, new Promise((resolve, reject) => {
    const image = new Image(); image.onload = () => resolve(image); image.onerror = () => { images.delete(name); reject(new Error('角色图片加载失败')); }; image.src = `../../assets/${name}.png`;
  }));
  return images.get(name);
}
export async function drawSprite(canvas, appearance = 'cute', action = 'idle') {
  const request = `${appearance}:${action}`; canvas.dataset.request = request;
  const pose = action === 'busy' ? '-working' : action === 'sad' ? (appearance === 'mature' ? '-disappointed' : '-crying') : '';
  const image = await loadSheet(appearance, pose);
  if (canvas.dataset.request !== request) return;
  const index = pose ? 0 : Math.max(0, states.indexOf(action));
  const sw = image.width / (pose ? 1 : 4), sh = image.height / (pose ? 1 : 2);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const scale = Math.min(canvas.width / sw, canvas.height / sh);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, (index % 4) * sw, Math.floor(index / 4) * sh, sw, sh, (canvas.width - sw * scale) / 2, canvas.height - sh * scale, sw * scale, sh * scale);
  canvas.dataset.action = action;
  canvas.dataset.asset = (appearance === 'mature' ? 'mature' : 'cute') + pose + '.png';
}
