// gov.uk HTML → plain-text guidance chunks (SPEC §4.7, §7 guidance_chunks). Highway Code pages mark each rule
// with <h3 id="ruleN">; a rule runs until the next heading or the end of the article. Tables, images and the
// "Laws …" lines, captions and download links are left out: the model only needs the advice itself.

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ndash: '–', mdash: '—' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** A piece of gov.uk HTML as readable text: one line per paragraph or list item. */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<(table|figure|figcaption|script|style)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<div class="call-to-action">[\s\S]*?<\/div>/gi, '')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(p|li|ul|ol|div|h\d)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(text)
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l && l !== '-' && !/^Laws? /.test(l))
    .join('\n');
}

/** The text of Highway Code rule `n` on a page, or null if the page doesn't have it. */
export function ruleText(html: string, n: number): string | null {
  const start = html.indexOf(`<h3 id="rule${n}"`);
  if (start < 0) return null;
  const bodyStart = html.indexOf('</h3>', start) + '</h3>'.length;
  const rest = html.slice(bodyStart);
  const end = rest.search(/<h[23]\b|<\/article>/i);
  return htmlToText(end < 0 ? rest : rest.slice(0, end)) || null;
}

/** The text from the first place `from` appears up to the heading with id `toId` (for pages without rule numbers). */
export function sectionText(html: string, from: string, toId: string): string | null {
  const start = html.indexOf(from);
  if (start < 0) return null;
  // Back up to the start of the tag the text is in, so it isn't left half-open.
  const tagStart = html.lastIndexOf('<', start);
  const end = html.indexOf(`id="${toId}"`, start);
  if (end < 0) return null;
  return htmlToText(html.slice(tagStart, html.lastIndexOf('<', end))) || null;
}
