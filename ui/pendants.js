// 头像挂件, drawn in SVG over the user's avatar. The drawing box is larger than the avatar (see .pendant in phone.css):
// the avatar is the circle at (50, 50) with radius 37 in a 100 × 100 box, so ears, a halo or flowers can stick out.
const R = 37;
const at = (deg, r = R) => [50 + r * Math.cos(deg * Math.PI / 180), 50 + r * Math.sin(deg * Math.PI / 180)].map(n => +n.toFixed(2));

/** A five-point star centred at (x, y). */
function star(x, y, outer, inner = outer * .45) {
  const points = Array.from({length: 10}, (_, i) => { const r = i % 2 ? inner : outer, a = -90 + i * 36; return at(a, r).map((v, k) => v - 50 + [x, y][k]).join(','); });
  return points.join(' ');
}
/** A four-point sparkle centred at (x, y). */
const sparkle = (x, y, s) => `M${x} ${y - s}Q${x + s * .18} ${y - s * .18} ${x + s} ${y}Q${x + s * .18} ${y + s * .18} ${x} ${y + s}Q${x - s * .18} ${y + s * .18} ${x - s} ${y}Q${x - s * .18} ${y - s * .18} ${x} ${y - s}Z`;
/** A five-petal flower centred at (x, y). */
function flower(x, y, size, petal, heart) {
  const petals = Array.from({length: 5}, (_, i) => { const [px, py] = at(-90 + i * 72, size * .62).map((v, k) => v - 50 + [x, y][k]); return `<circle cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" r="${(size * .5).toFixed(2)}" fill="${petal}"/>`; }).join('');
  return `<g stroke="#fff" stroke-width=".8">${petals}</g><circle cx="${x}" cy="${y}" r="${(size * .34).toFixed(2)}" fill="${heart}"/>`;
}

const DRAW = {
  star: () => {
    const [x, y] = at(-42, R + 4);
    return `<defs><linearGradient id="pd-star" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe68a"/><stop offset="1" stop-color="#f7a928"/></linearGradient></defs>
      <circle cx="50" cy="50" r="${R + 1.5}" fill="none" stroke="#f7c948" stroke-width="2" stroke-dasharray="1 5.2" stroke-linecap="round"/>
      <polygon points="${star(x, y, 13)}" fill="url(#pd-star)" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/>
      <path d="${sparkle(x + 13, y + 17, 4.5)}" fill="#fff4c2"/><path d="${sparkle(16, 22, 3.2)}" fill="#ffe68a"/>`;
  },
  cat: () => {
    const ear = side => {
      const m = v => side < 0 ? v : 100 - v;
      return `<path d="M${m(15)} 34 L${m(19)} 4 L${m(44)} 15 Z" fill="#fbe3ec" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/><path d="M${m(21)} 27 L${m(23)} 12 L${m(36)} 18 Z" fill="#ff9dbb"/>`;
    };
    return `${ear(-1)}${ear(1)}<g fill="#ff9dbb" opacity=".85"><ellipse cx="30" cy="66" rx="5" ry="3"/><ellipse cx="70" cy="66" rx="5" ry="3"/></g>`;
  },
  flower: () => {
    const kinds = [['#ffb3cf', '#ffd76a'], ['#fff3f7', '#ff9dbb'], ['#ffc9a8', '#fff3b0']];
    // A garland around the chin: flowers along the lower half of the avatar, leaves between them.
    const angles = [22, 50, 78, 106, 134, 162];
    const leaves = angles.slice(0, -1).map(a => { const [x, y] = at(a + 14, R + 1); return `<ellipse cx="${x}" cy="${y}" rx="4.6" ry="2.2" fill="#8fd69a" transform="rotate(${a + 104} ${x} ${y})"/>`; }).join('');
    return leaves + angles.map((a, i) => { const [x, y] = at(a, R + 1); const [petal, heart] = kinds[i % 3]; return flower(x, y, i % 2 ? 9 : 11, petal, heart); }).join('');
  },
  halo: () => `<defs><linearGradient id="pd-halo" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffd86a"/><stop offset=".5" stop-color="#fff6c9"/><stop offset="1" stop-color="#ffc24a"/></linearGradient></defs>
      <ellipse cx="50" cy="7" rx="25" ry="6" fill="none" stroke="#ffd86a" stroke-opacity=".45" stroke-width="7"/>
      <ellipse cx="50" cy="7" rx="25" ry="6" fill="none" stroke="url(#pd-halo)" stroke-width="3.4"/>
      <path d="${sparkle(86, 22, 5)}" fill="#fff4c2"/><path d="${sparkle(13, 30, 3.6)}" fill="#ffe68a"/><path d="${sparkle(90, 70, 2.8)}" fill="#fff"/>`
};

/** The pendant for a frame key, or '' for none. Gradient ids are made unique per drawing. */
let serial = 0;
export function pendant(frame) {
  const draw = DRAW[frame];
  if (!draw) return '';
  const n = ++serial;
  return `<svg class="pendant" viewBox="0 0 100 100" aria-hidden="true">${draw().replaceAll('pd-star', 'pd-star' + n).replaceAll('pd-halo', 'pd-halo' + n)}</svg>`;
}
