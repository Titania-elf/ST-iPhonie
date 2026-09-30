// Voice languages the phone offers, as [code, 中文名]. The code is what the voice engines get; the name is what prompts
// and the phone show. A code not in the list (typed by the user) is shown as it is.
export const LANGUAGES = Object.freeze([['', '跟随默认'], ['zh', '中文'], ['en', '英语'], ['ja', '日语'], ['ko', '韩语'], ['fr', '法语'], ['de', '德语'], ['es', '西班牙语'], ['ru', '俄语'], ['it', '意大利语'], ['pt', '葡萄牙语'], ['ar', '阿拉伯语'], ['hi', '印地语'], ['th', '泰语'], ['vi', '越南语']]);
export const languageName = code => LANGUAGES.find(([value]) => value && value === String(code || '').trim().toLowerCase())?.[1] || String(code || '').trim() || '中文';
