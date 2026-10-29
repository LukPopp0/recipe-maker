// Minimal hand-written typing of the WebExtension API surface this extension uses.
// Firefox exposes promise-based `browser`; Chrome MV3 exposes promise-capable `chrome`.

interface ApiEvent<Args extends unknown[]> {
  addListener(listener: (...args: Args) => unknown): void;
  removeListener(listener: (...args: Args) => unknown): void;
}

export interface ExtensionTab {
  id?: number;
  index?: number;
  url?: string;
  title?: string;
}

export interface ExtensionSender {
  id?: string;
  frameId?: number;
  url?: string;
  tab?: ExtensionTab;
}

export interface ExtensionApi {
  action: {
    onClicked: ApiEvent<[ExtensionTab]>;
  };
  tabs: {
    create(options: { url: string; index?: number; active?: boolean }): Promise<ExtensionTab>;
    onUpdated: ApiEvent<[number, { status?: string; url?: string }, ExtensionTab]>;
    onRemoved: ApiEvent<[number]>;
  };
  scripting: {
    executeScript(injection: {
      target: { tabId: number };
      func?: (...args: never[]) => unknown;
      args?: unknown[];
      files?: string[];
    }): Promise<Array<{ result?: unknown }>>;
  };
  runtime: {
    id?: string;
    getURL(path: string): string;
    // Return true and call sendResponse later to answer asynchronously (works in both browsers).
    onMessage: ApiEvent<[unknown, ExtensionSender, (response?: unknown) => void]>;
    sendMessage(message: unknown): Promise<unknown>;
    openOptionsPage(): Promise<void>;
  };
  storage: {
    local: {
      get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
  };
  permissions: {
    request(permissions: { origins?: string[]; permissions?: string[] }): Promise<boolean>;
    contains(permissions: { origins?: string[]; permissions?: string[] }): Promise<boolean>;
  };
}

type ApiGlobals = { browser?: ExtensionApi; chrome?: ExtensionApi };

export function findExtensionApi(): ExtensionApi | undefined {
  const g = globalThis as unknown as ApiGlobals;
  return g.browser ?? g.chrome;
}

export function getExtensionApi(): ExtensionApi {
  const api = findExtensionApi();
  if (!api) throw new Error('No WebExtension API found: neither `browser` nor `chrome` exists in this context.');
  return api;
}
