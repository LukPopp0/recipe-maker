import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { CAPTURE_PROTOCOL, EXTENSION_CHANNEL } from 'shared';
import { useCaptureHandoff } from './use-capture-handoff.ts';

const payload = { url: 'https://example.com/r', html: '<html></html>' };
let openerFrame: HTMLIFrameElement;
let otherFrame: HTMLIFrameElement;
let openerPost: ReturnType<typeof vi.fn>;

function dispatch(data: unknown, source: Window | null) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, source }));
  });
}

beforeEach(() => {
  openerFrame = document.createElement('iframe');
  otherFrame = document.createElement('iframe');
  document.body.append(openerFrame, otherFrame);
  openerPost = vi.fn();
  openerFrame.contentWindow!.postMessage = openerPost as unknown as typeof window.postMessage;
  Object.defineProperty(window, 'opener', { value: openerFrame.contentWindow, configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.defineProperty(window, 'opener', { value: null, configurable: true });
  openerFrame.remove();
  otherFrame.remove();
  window.history.replaceState(null, '', '/');
});

const payloadMsg = { protocol: CAPTURE_PROTOCOL, type: 'payload', payload };

describe('useCaptureHandoff', () => {
  it('posts ready to the opener and to its own window for the extension bridge', () => {
    const selfPost = vi.spyOn(window, 'postMessage');
    renderHook(() => useCaptureHandoff(true));

    expect(openerPost).toHaveBeenCalledWith({ protocol: CAPTURE_PROTOCOL, type: 'ready' }, '*');
    expect(selfPost).toHaveBeenCalledWith(
      { protocol: CAPTURE_PROTOCOL, type: 'ready', channel: EXTENSION_CHANNEL },
      window.location.origin,
    );
  });

  it('accepts a payload from window.opener and replaces /capture with /', async () => {
    window.history.replaceState(null, '', '/capture');
    const { result } = renderHook(() => useCaptureHandoff(true));

    dispatch(payloadMsg, openerFrame.contentWindow);

    await waitFor(() => expect(result.current.state).toEqual({ phase: 'received', payload }));
    expect(window.location.pathname).toBe('/');
  });

  it('accepts a payload from its own window only with the extension channel marker', () => {
    const { result } = renderHook(() => useCaptureHandoff(true));

    dispatch(payloadMsg, window);
    expect(result.current.state).toEqual({ phase: 'waiting' });

    dispatch({ ...payloadMsg, channel: EXTENSION_CHANNEL }, window);
    expect(result.current.state).toEqual({ phase: 'received', payload });
  });

  it('ignores payloads from other windows and channel-marked opener messages', () => {
    const { result } = renderHook(() => useCaptureHandoff(true));

    dispatch(payloadMsg, otherFrame.contentWindow);
    dispatch({ ...payloadMsg, channel: EXTENSION_CHANNEL }, openerFrame.contentWindow);
    dispatch(payloadMsg, null);

    expect(result.current.state).toEqual({ phase: 'waiting' });
  });

  it('fails after the timeout without a payload', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCaptureHandoff(true, { timeoutMs: 15000 }));

    act(() => {
      vi.advanceTimersByTime(15000);
    });

    expect(result.current.state).toEqual({ phase: 'failed' });
  });

  it('relays a request on the payload channel and resolves with the reply image', async () => {
    const { result } = renderHook(() => useCaptureHandoff(true));
    dispatch(payloadMsg, openerFrame.contentWindow);
    openerPost.mockClear();

    let promise!: Promise<Blob | null>;
    act(() => {
      promise = result.current.requestRelay('https://img/a.jpg');
    });
    const request = openerPost.mock.calls[0][0] as { type: string; id: string; url: string };
    expect(request).toMatchObject({ protocol: CAPTURE_PROTOCOL, type: 'relay-request', url: 'https://img/a.jpg' });

    const image = new Blob(['x'], { type: 'image/png' });
    dispatch(
      { protocol: CAPTURE_PROTOCOL, type: 'relay-reply', id: request.id, url: request.url, image },
      openerFrame.contentWindow,
    );

    await expect(promise).resolves.toBe(image);
  });

  it('resolves a relay request with null on timeout', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCaptureHandoff(true, { relayTimeoutMs: 30000 }));
    dispatch(payloadMsg, openerFrame.contentWindow);

    let promise!: Promise<Blob | null>;
    act(() => {
      promise = result.current.requestRelay('https://img/a.jpg');
    });
    await act(async () => {
      vi.advanceTimersByTime(30000);
    });

    await expect(promise).resolves.toBeNull();
  });

  it('does nothing when disabled', () => {
    const selfPost = vi.spyOn(window, 'postMessage');
    const { result } = renderHook(() => useCaptureHandoff(false));

    expect(result.current.state).toEqual({ phase: 'off' });
    expect(openerPost).not.toHaveBeenCalled();
    expect(selfPost).not.toHaveBeenCalled();
  });
});
