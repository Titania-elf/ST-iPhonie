// 世界书 for the phone: chat replies, calls and 朋友圈 are asked for apart from the story (generateRaw), so the tavern
// does not add its World Info to them. This asks the tavern which entries the same scan would turn on (the active
// character's book, global and chat books, constant entries, keywords found in the given text) without changing
// anything (dry run: no activation events, timers left alone), and returns their text for the phone's own prompt.
const LORE_MAX = 12000;

/**
 * texts: what to scan, oldest first (the phone conversation, recent story, the contacts' names).
 * persona / characters: the user's persona and the contacts' card text, for entries that also match those.
 * Returns '' when the tavern has no World Info for this (or is older than 1.12.14).
 */
export async function worldInfoFor(context, {texts = [], persona = '', characters = ''} = {}) {
  const ctx = context();
  if (typeof ctx?.getWorldInfoPrompt !== 'function') return '';
  try {
    const scan = texts.map(t => String(t || '').trim()).filter(Boolean).reverse();
    const r = await ctx.getWorldInfoPrompt(scan, Number(ctx.maxContext) || 8192, true,
      {trigger: 'normal', personaDescription: persona, characterDescription: characters, characterPersonality: '', characterDepthPrompt: '', scenario: '', creatorNotes: ''});
    const parts = [r?.worldInfoBefore, r?.worldInfoAfter, ...(r?.anBefore || []), ...(r?.anAfter || []),
      ...(r?.worldInfoDepth || []).flatMap(d => d?.entries || []), ...(r?.worldInfoExamples || []).map(e => e?.content)];
    const seen = new Set(), out = [];
    for (const part of parts) { const text = String(part || '').trim(); if (text && !seen.has(text)) { seen.add(text); out.push(text); } }
    return out.join('\n\n').slice(0, LORE_MAX);
  } catch { return ''; }
}
