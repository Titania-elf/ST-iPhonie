// Built-in wallpapers. Keys come from the backend's phoneCatalog.wallpapers.
//   clock: stroke (white outlined clock) | glow (light clock with a glow)
//   night: variant used when the phone runs in dark mode
const clouds = 'radial-gradient(55% 12% at 22% 76%,#fff 0,#fff0 70%),radial-gradient(45% 10% at 78% 70%,#ffffffee 0,#fff0 70%),radial-gradient(70% 14% at 55% 88%,#fff 0,#fff0 70%)';
const stars = 'radial-gradient(1.5px 1.5px at 18px 26px,#fff,#fff0),radial-gradient(1px 1px at 92px 70px,#ffffffcc,#fff0),radial-gradient(1.2px 1.2px at 140px 18px,#fff,#fff0),radial-gradient(1px 1px at 60px 130px,#ffffffaa,#fff0),radial-gradient(1.6px 1.6px at 120px 150px,#fff,#fff0)';
const starSize = '170px 170px,170px 170px,170px 170px,170px 170px,170px 170px';

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
  }
};

// Returns the look to apply for a builtin key, honouring the dark variant.
export function wallpaperLook(key, dark) {
  const w = wallpapers[key] || wallpapers.sky;
  return dark && w.night ? {...w, ...w.night} : w;
}
