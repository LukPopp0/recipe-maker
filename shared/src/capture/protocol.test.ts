// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { CAPTURE_PROTOCOL, isCaptureMessage } from './protocol.js';

describe('isCaptureMessage', () => {
  it('accepts each message type', () => {
    const msgs = [
      { protocol: CAPTURE_PROTOCOL, type: 'ready' },
      { protocol: CAPTURE_PROTOCOL, type: 'payload', payload: { url: 'u', html: 'h' } },
      { protocol: CAPTURE_PROTOCOL, type: 'relay-request', id: '1', url: 'u' },
      { protocol: CAPTURE_PROTOCOL, type: 'relay-reply', id: '1', url: 'u', image: null },
    ];
    for (const m of msgs) expect(isCaptureMessage(m)).toBe(true);
  });
  it('rejects a wrong protocol, missing type and non-objects', () => {
    expect(isCaptureMessage({ protocol: 'other', type: 'ready' })).toBe(false);
    expect(isCaptureMessage({ protocol: CAPTURE_PROTOCOL })).toBe(false);
    expect(isCaptureMessage({ protocol: CAPTURE_PROTOCOL, type: 'nope' })).toBe(false);
    for (const v of [null, undefined, 'ready', 42]) expect(isCaptureMessage(v)).toBe(false);
  });
});
