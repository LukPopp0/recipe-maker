// Pure tokenizer for pretty-printed JSON (as produced by JSON.stringify(x,
// null, 2)). Used by JsonPanel to render a colorized viewer without
// dangerouslySetInnerHTML - each token becomes its own React span.
//
// Any leading whitespace run is folded into the token that follows it, so
// concatenating every token's `text` in order reproduces the input exactly
// (this is asserted in json-highlight.test.ts).

export type HighlightKind = 'key' | 'string' | 'number' | 'literal' | 'punctuation';

export type HighlightToken = {
  kind: HighlightKind
  text: string
};

const WHITESPACE = /\s/;
const DIGIT_START = /[-0-9]/;
const NUMBER_BODY = /[0-9.eE+-]/;
const LITERALS = ['true', 'false', 'null'] as const;

function readWhitespace(json: string, index: number): number {
  let i = index;
  while (i < json.length && WHITESPACE.test(json[i])) i++;
  return i;
}

// Scans a JSON string literal (including surrounding quotes and escapes)
// starting at a `"` character. Returns the index just past the closing quote.
function readStringEnd(json: string, start: number): number {
  let i = start + 1;
  while (i < json.length) {
    if (json[i] === '\\') {
      i += 2;
      continue;
    }
    if (json[i] === '"') {
      return i + 1;
    }
    i++;
  }
  return i;
}

function readNumberEnd(json: string, start: number): number {
  let i = start + 1;
  while (i < json.length && NUMBER_BODY.test(json[i])) i++;
  return i;
}

export function highlightJson(json: string): HighlightToken[] {
  const tokens: HighlightToken[] = [];
  let i = 0;

  while (i < json.length) {
    const start = i;
    i = readWhitespace(json, i);
    const wsPrefix = json.slice(start, i);

    if (i >= json.length) {
      if (wsPrefix.length > 0) tokens.push({ kind: 'punctuation', text: wsPrefix });
      break;
    }

    const ch = json[i];

    if (ch === '"') {
      const end = readStringEnd(json, i);
      const content = json.slice(i, end);
      const j = readWhitespace(json, end);
      const kind: HighlightKind = json[j] === ':' ? 'key' : 'string';
      tokens.push({ kind, text: wsPrefix + content });
      i = end;
      continue;
    }

    if (DIGIT_START.test(ch)) {
      const end = readNumberEnd(json, i);
      tokens.push({ kind: 'number', text: wsPrefix + json.slice(i, end) });
      i = end;
      continue;
    }

    const literal = LITERALS.find((word) => json.startsWith(word, i));
    if (literal) {
      tokens.push({ kind: 'literal', text: wsPrefix + literal });
      i += literal.length;
      continue;
    }

    // Structural single character: { } [ ] , :
    tokens.push({ kind: 'punctuation', text: wsPrefix + ch });
    i += 1;
  }

  return tokens;
}
