// Receives the captured recipe page from the capture source and relays image
// fetches back to it (docs/specs/15). The source is either the recipe tab that
// opened this one (bookmarklet, window.opener) or the browser extension's
// bridge content script, which posts on this window with a channel marker.
import { useCallback, useEffect, useRef, useState } from 'react';
import { CAPTURE_PROTOCOL, EXTENSION_CHANNEL, isCaptureMessage } from 'shared';
import type { CaptureMessage, CapturePayload } from 'shared';

export type HandoffState =
  | { phase: 'off' }
  | { phase: 'waiting' }
  | { phase: 'received'; payload: CapturePayload }
  | { phase: 'failed' };

type Options = { timeoutMs?: number; readyIntervalMs?: number; relayTimeoutMs?: number };
type Source = 'opener' | 'extension';

function post(source: Source, message: CaptureMessage): void {
  try {
    if (source === 'opener') {
      // The opener's origin is the unknown recipe site; ready/relay-request
      // carry no recipe data, so '*' is intended.
      window.opener?.postMessage(message, '*');
    } else {
      window.postMessage({ ...message, channel: EXTENSION_CHANNEL }, window.location.origin);
    }
  } catch {
    // A closed or navigated opener just means no reply; timeouts handle it.
  }
}

function sourceOf(event: MessageEvent, message: CaptureMessage): Source | null {
  if (event.source !== null && event.source === window.opener && message.channel === undefined) return 'opener';
  if (event.source === window && message.channel === EXTENSION_CHANNEL) return 'extension';
  return null;
}

export function useCaptureHandoff(
  enabled: boolean,
  opts: Options = {},
): { state: HandoffState; requestRelay: (url: string) => Promise<Blob | null> } {
  const { timeoutMs = 15000, readyIntervalMs = 500, relayTimeoutMs = 30000 } = opts;
  const [state, setState] = useState<HandoffState>(enabled ? { phase: 'waiting' } : { phase: 'off' });
  const sourceRef = useRef<Source | null>(null);
  const pending = useRef(new Map<string, { url: string; settle: (blob: Blob | null) => void }>());

  useEffect(() => {
    if (!enabled) return;
    sourceRef.current = null;

    const sendReady = () => {
      const ready: CaptureMessage = { protocol: CAPTURE_PROTOCOL, type: 'ready' };
      post('opener', ready);
      post('extension', ready);
    };

    const stop = () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };

    const onMessage = (event: MessageEvent) => {
      const message: unknown = event.data;
      if (!isCaptureMessage(message)) return;
      const source = sourceOf(event, message);
      if (source === null) return;

      if (message.type === 'payload') {
        if (sourceRef.current !== null) return;
        sourceRef.current = source;
        stop();
        // Only the capture entry is replaced; never clobber /setup if it is shown.
        if (window.location.pathname === '/capture') window.history.replaceState(null, '', '/');
        setState({ phase: 'received', payload: message.payload });
      } else if (message.type === 'relay-reply') {
        if (source !== sourceRef.current) return;
        const entry = pending.current.get(message.id);
        if (entry && entry.url === message.url) {
          pending.current.delete(message.id);
          entry.settle(message.image);
        }
      }
    };

    window.addEventListener('message', onMessage);
    sendReady();
    const interval = window.setInterval(sendReady, readyIntervalMs);
    const timeout = window.setTimeout(() => {
      stop();
      if (sourceRef.current === null) setState({ phase: 'failed' });
    }, timeoutMs);

    return () => {
      stop();
      window.removeEventListener('message', onMessage);
    };
  }, [enabled, timeoutMs, readyIntervalMs]);

  // No relay request outlives the page: unmount settles them all with null.
  useEffect(() => {
    const map = pending.current;
    return () => {
      for (const entry of map.values()) entry.settle(null);
      map.clear();
    };
  }, []);

  const requestRelay = useCallback(
    (url: string): Promise<Blob | null> => {
      const source = sourceRef.current;
      if (source === null) return Promise.resolve(null);
      // A closed or missing opener can never answer: do not wait out the timeout.
      if (source === 'opener' && (!window.opener || window.opener.closed)) return Promise.resolve(null);
      const id = crypto.randomUUID();
      return new Promise((resolve) => {
        const timer = window.setTimeout(() => {
          pending.current.delete(id);
          resolve(null);
        }, relayTimeoutMs);
        pending.current.set(id, {
          url,
          settle: (blob) => {
            window.clearTimeout(timer);
            resolve(blob);
          },
        });
        post(source, { protocol: CAPTURE_PROTOCOL, type: 'relay-request', id, url });
      });
    },
    [relayTimeoutMs],
  );

  return { state, requestRelay };
}
