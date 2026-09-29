// Built-in wallpapers. Keys come from the backend's phoneCatalog.wallpapers.
//   clock: stroke (white outlined clock) | glow (light clock with a glow)
//   night: variant used when the phone runs in dark mode
//   size / pos: per-layer background-size / background-position lists (default auto / center)
const clouds = 'radial-gradient(55% 12% at 22% 76%,#fff 0,#fff0 70%),radial-gradient(45% 10% at 78% 70%,#ffffffee 0,#fff0 70%),radial-gradient(70% 14% at 55% 88%,#fff 0,#fff0 70%)';
const stars = 'radial-gradient(1.5px 1.5px at 18px 26px,#fff,#fff0),radial-gradient(1px 1px at 92px 70px,#ffffffcc,#fff0),radial-gradient(1.2px 1.2px at 140px 18px,#fff,#fff0),radial-gradient(1px 1px at 60px 130px,#ffffffaa,#fff0),radial-gradient(1.6px 1.6px at 120px 150px,#fff,#fff0)';
const starSize = '170px 170px,170px 170px,170px 170px,170px 170px,170px 170px';

// Soap bubbles for the Aero wallpaper: a faint body with a bright rim.
const bubble = (r, x, y) => `radial-gradient(circle ${r}px at ${x} ${y},#ffffff14 0 62%,#ffffffcc 80%,#ffffff33 90%,#fff0 100%)`;
const bubbles = [bubble(34, '78%', '20%'), bubble(18, '66%', '30%'), bubble(12, '86%', '34%'), bubble(22, '14%', '46%'), bubble(9, '24%', '38%'), bubble(14, '58%', '52%')].join(',');
const night = {
  ink: '#fff', clock: 'glow', stroke: '#9cc8ff', halo: '#000',
  background: `${stars},radial-gradient(60% 30% at 80% 100%,#ff9cc055 0,#fff0 70%),linear-gradient(180deg,#0c1030 0%,#1f2462 48%,#4b3f86 82%,#7a5a92 100%)`,
  size: `${starSize},auto,auto`
};

export const wallpapers = {
  sky: {
    name: '晴空', ink: '#1d3358', clock: 'stroke', stroke: '#3a8ee0', shadow: '#2f78c4', halo: '#fff', night,
    background: `${clouds},radial-gradient(40% 25% at 85% 12%,#ffffff55 0,#fff0 70%),linear-gradient(180deg,#4aa6f0 0%,#86ccff 36%,#cfeaff 60%,#fff3ee 100%)`
  },
  silver: {
    name: '月白', ink: '#2c3350', clock: 'stroke', stroke: '#8a8fd6', shadow: '#6d70b8', halo: '#fff',
    background: `${clouds},linear-gradient(180deg,#b9bff0 0%,#dcdcfb 40%,#f4f1ff 70%,#fffaf6 100%)`
  },
  midnight: {name: '星夜', ...night},
  rose: {
    name: '樱色', ink: '#5a2a44', clock: 'stroke', stroke: '#e2638f', shadow: '#c24a78', halo: '#fff',
    background: `${clouds},radial-gradient(40% 25% at 15% 12%,#ffffff66 0,#fff0 70%),linear-gradient(180deg,#ff9fc0 0%,#ffc4d8 38%,#ffe5ee 64%,#fff8f0 100%)`
  },
  sand: {
    name: '暮霞', ink: '#fff', clock: 'stroke', stroke: '#d0703e', shadow: '#a5552d', halo: '#7a3b2a',
    background: `radial-gradient(60% 18% at 30% 80%,#ffe0b866 0,#fff0 70%),linear-gradient(180deg,#5b5bb8 0%,#b37ab5 38%,#f39a86 66%,#ffd3a0 100%)`
  },
  // Skin wallpapers: each skin switches to its own wallpaper while a built-in one is in use.
  aero: {
    name: '水感晴空', ink: '#08354d', clock: 'stroke', stroke: '#1592d0', shadow: '#0c6fa3', halo: '#fff',
    background: `${bubbles},conic-gradient(from 196deg at 12% -4%,#fff0 0deg,#ffffff38 5deg,#fff0 10deg,#ffffff2a 17deg,#fff0 22deg,#ffffff22 30deg,#fff0 36deg),radial-gradient(120% 34% at 22% 104%,#63c93c 0 48%,#63c93c00 49.5%),radial-gradient(95% 30% at 88% 104%,#3fae2e 0 48%,#3fae2e00 49.5%),radial-gradient(70% 22% at 55% 100%,#9be36a 0 46%,#9be36a00 48%),linear-gradient(180deg,#0b93d8 0%,#4cc3f6 34%,#bdeeff 62%,#e6fbd8 80%,#8fdc68 100%)`,
    night: {
      ink: '#e6fbff', clock: 'glow', stroke: '#52d6ff', halo: '#021a26',
      background: `${bubbles},radial-gradient(80% 26% at 30% 34%,#39f0c455 0,#39f0c400 70%),radial-gradient(70% 20% at 75% 26%,#3a8cff44 0,#3a8cff00 70%),radial-gradient(120% 34% at 22% 104%,#0f5a3a 0 48%,#0f5a3a00 49.5%),radial-gradient(95% 30% at 88% 104%,#0b4630 0 48%,#0b463000 49.5%),linear-gradient(180deg,#021526 0%,#063a5c 45%,#0a6178 75%,#0d4a45 100%)`
    }
  }
};

// Returns the look to apply for a builtin key, honouring the dark variant.
export function wallpaperLook(key, dark) {
  const w = wallpapers[key] || wallpapers.sky;
  return dark && w.night ? {...w, ...w.night} : w;
}

// Phone skins (see skins.css). preview: [page, card, accent, second colour] for the picker in Settings.
export const skins = {
  sky: {name: '晴空贴纸', preview: ['#8fd0ff', '#ffffff', '#1f74cc', '#ff7eaa']},
  aero: {name: 'Frutiger Aero', preview: ['#4cc3f6', '#f4fdff', '#1494d2', '#5cc93a']}
};
