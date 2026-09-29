// App registry. Adding an app: add an entry here, register its factory in phone.js,
// and place its id on the home screen below (a reserved slot is replaced by the id).
//   colors: [tile top, tile bottom / glyph shade, glyph accent]
export const APPS = {
  roles: {name: '角色', eyebrow: 'Character', colors: ['#9ad8ff', '#4a9af0', '#ff9dbb']},
  engines: {name: '引擎', eyebrow: 'Wallet', colors: ['#cdb6ff', '#8a6cf2', '#fff09a']},
  presets: {name: '预设', eyebrow: 'Preset', colors: ['#ffe39c', '#ffac3f', '#ff7f86']},
  library: {name: '音频收藏', eyebrow: 'Voice Library', colors: ['#ffb6cc', '#ee6690', '#fff0a0']},
  gallery: {name: '相册', eyebrow: 'Album', colors: ['#ffcfb0', '#ff8d69', '#8fd1ff']},
  notes: {name: '备忘录', eyebrow: 'Memo', colors: ['#fff4b3', '#f6c53c', '#ff9d5c']},
  listen: {name: '听取', eyebrow: 'Now Playing', colors: ['#ffa3c3', '#e9588e', '#fff09a']},
  settings: {name: '设置', eyebrow: 'Settings', colors: ['#e4e8f0', '#98a2b6', '#ffd36a']},
  draw: {name: '绘图', eyebrow: 'NovelAI', colors: ['#c3c3ff', '#6d6ff0', '#ffd46a']},
  chat: {name: '聊天', eyebrow: 'Messages', colors: ['#8fd8ff', '#3d8ff0', '#ff9dbb']}
};

export const SLOT = null;

// Home screen: page 1 sits under the clock and widgets; page 2 is kept for future apps.
export const HOME = {
  pages: [
    ['roles', 'engines', 'presets', 'library', 'gallery', 'notes'],
    [SLOT, SLOT, SLOT, SLOT, SLOT, SLOT, SLOT, SLOT]
  ],
  dock: ['chat', 'draw', 'listen', 'settings']
};

export const appName = id => APPS[id]?.name || id;
