// TfNSW alert text "may contain HTML tags and/or HTML entities" (Trip Planner spec). The app shows plain
// text, so tags are removed and entities decoded, keeping paragraph and line breaks.

const LINE_BREAK_TAG = /<\s*(?:br|\/p|\/div|\/li|\/h[1-6])\b[^>]*>/gi;
const ANY_TAG = /<[^>]*>/g;
const ENTITY = /&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi;
const SPACES = /[ \t\f\v\u00a0]+/g;

// A Map, so entity names such as "constructor" cannot reach Object.prototype.
const NAMED_ENTITIES: ReadonlyMap<string, string> = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
  ['nbsp', ' '],
  ['lsquo', '\u2018'],
  ['rsquo', '\u2019'],
  ['ldquo', '\u201c'],
  ['rdquo', '\u201d'],
  ['hellip', '\u2026'],
  ['ndash', '\u2013'],
  ['mdash', '\u2014'],
]);

export function htmlToText(html: string): string {
  const withoutTags = html.replace(LINE_BREAK_TAG, '\n').replace(ANY_TAG, '');
  return decodeEntities(withoutTags)
    .split('\n')
    .map((line) => line.replace(SPACES, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

function decodeEntities(text: string): string {
  return text.replace(ENTITY, (entity: string, body: string) => {
    if (body.startsWith('#')) {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const codePoint = Number.parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return isUsableCodePoint(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }
    return NAMED_ENTITIES.get(body.toLowerCase()) ?? entity;
  });
}

function isUsableCodePoint(codePoint: number): boolean {
  const isSurrogate = codePoint >= 0xd800 && codePoint <= 0xdfff;
  return Number.isInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff && !isSurrogate;
}
