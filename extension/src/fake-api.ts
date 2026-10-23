// Test helper: a hand-made ExtensionApi that records calls and exposes the registered listeners.
import type { ExtensionApi, ExtensionSender, ExtensionTab } from './api';

export type Call = { name: string; args: unknown[] };

type Options = {
  storage?: Record<string, unknown>;
  createdTabId?: number;
  executeScript?: (injection: { func?: unknown; files?: string[]; target: { tabId: number } }) => Promise<Array<{ result?: unknown }>>;
  permissionGranted?: boolean;
  hostAccess?: boolean;
};

export function createFakeApi(opts: Options = {}) {
  const calls: Call[] = [];
  const stored: Record<string, unknown> = { ...(opts.storage ?? {}) };
  const clicked: Array<(tab: ExtensionTab) => unknown> = [];
  const updated: Array<(id: number, info: { status?: string }, tab: ExtensionTab) => unknown> = [];
  const removed: Array<(id: number) => unknown> = [];
  const messages: Array<(m: unknown, s: ExtensionSender, r: (v?: unknown) => void) => unknown> = [];
  const record = (name: string, ...args: unknown[]) => calls.push({ name, args });

  const api = {
    action: { onClicked: { addListener: (l: never) => clicked.push(l), removeListener: () => {} } },
    tabs: {
      create: async (o: unknown) => {
        record('tabs.create', o);
        return { id: opts.createdTabId ?? 99 };
      },
      onUpdated: { addListener: (l: never) => updated.push(l), removeListener: () => {} },
      onRemoved: { addListener: (l: never) => removed.push(l), removeListener: () => {} },
    },
    scripting: {
      executeScript: async (i: { func?: unknown; files?: string[]; target: { tabId: number } }) => {
        record('scripting.executeScript', i);
        return opts.executeScript ? opts.executeScript(i) : [{}];
      },
    },
    runtime: {
      id: 'ext-id',
      onMessage: { addListener: (l: never) => messages.push(l), removeListener: () => {} },
      sendMessage: async (m: unknown) => {
        record('runtime.sendMessage', m);
        return null;
      },
      openOptionsPage: async () => {
        record('runtime.openOptionsPage');
      },
    },
    storage: {
      local: {
        get: async () => ({ ...stored }),
        set: async (items: Record<string, unknown>) => {
          record('storage.local.set', items);
          Object.assign(stored, items);
        },
      },
    },
    permissions: {
      request: async (p: unknown) => {
        record('permissions.request', p);
        return opts.permissionGranted ?? true;
      },
      contains: async () => opts.hostAccess ?? true,
    },
  } as unknown as ExtensionApi;

  return {
    api,
    calls,
    stored,
    fire: {
      actionClicked: (tab: ExtensionTab) => clicked[0](tab),
      tabRemoved: (id: number) => removed[0](id),
      tabUpdated: (id: number, info: { status?: string }, tab: ExtensionTab) => updated[0](id, info, tab),
      // Resolves with the response (sendResponse value), or undefined if the listener did not answer.
      message: (message: unknown, sender: ExtensionSender = {}) =>
        new Promise<unknown>((resolve) => {
          const keep = messages[0](message, sender, resolve);
          if (keep !== true) setTimeout(() => resolve(undefined), 0);
        }),
    },
  };
}

/** Let queued promise callbacks run. */
export const flush = () => new Promise((r) => setTimeout(r, 0));
