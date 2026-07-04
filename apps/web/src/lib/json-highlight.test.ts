import { describe, expect, it } from 'vitest';
import { highlightJson } from './json-highlight.ts';

describe('highlightJson', () => {
  it('tokenizes keys, strings, numbers, booleans, and null', () => {
    const json = JSON.stringify({ title: 'Soup', time: 30, ok: true, note: null }, null, 2);
    const tokens = highlightJson(json);

    const kinds = (kind: string) =>
      tokens.filter((token) => token.kind === kind).map((token) => token.text.trim());

    expect(kinds('key')).toEqual(['"title"', '"time"', '"ok"', '"note"']);
    expect(kinds('string')).toEqual(['"Soup"']);
    expect(kinds('number')).toEqual(['30']);
    expect(kinds('literal')).toEqual(['true', 'null']);
  });

  it('round-trips: concatenating all token text reproduces the input exactly', () => {
    const json = JSON.stringify(
      {
        title: 'Grandma\'s Soup',
        tags: ['easy', 'soup'],
        time: null,
        steps: [{ step_header: 'Boil', step_description: 'Boil water.' }],
        flag: false,
      },
      null,
      2,
    );

    const tokens = highlightJson(json);
    const reconstructed = tokens.map((token) => token.text).join('');

    expect(reconstructed).toBe(json);
  });

  it('round-trips on an empty object and empty array', () => {
    const emptyObj = JSON.stringify({}, null, 2);
    const emptyArr = JSON.stringify([], null, 2);

    expect(highlightJson(emptyObj).map((t) => t.text).join('')).toBe(emptyObj);
    expect(highlightJson(emptyArr).map((t) => t.text).join('')).toBe(emptyArr);
  });

  it('tokenizes punctuation for braces, brackets, colons, and commas', () => {
    const json = JSON.stringify({ a: 1, b: [1, 2] }, null, 2);
    const tokens = highlightJson(json);
    const punctuation = tokens.filter((token) => token.kind === 'punctuation').map((token) => token.text.trim());

    expect(punctuation).toEqual(expect.arrayContaining(['{', '}', '[', ']', ':', ',']));
  });

  it('distinguishes string values that look like numbers or literals from real numbers/literals', () => {
    const json = JSON.stringify({ a: '30', b: 'true', c: 'null' }, null, 2);
    const tokens = highlightJson(json);

    const stringValues = tokens.filter((token) => token.kind === 'string').map((token) => token.text.trim());
    expect(stringValues).toContain('"30"');
    expect(stringValues).toContain('"true"');
    expect(stringValues).toContain('"null"');
    expect(tokens.some((token) => token.kind === 'number')).toBe(false);
    expect(tokens.some((token) => token.kind === 'literal')).toBe(false);
  });
});
