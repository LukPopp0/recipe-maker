// Minimal hand-written typing of the WebExtension API surface this extension uses.
// Firefox exposes promise-based `browser`; Chrome MV3 exposes promise-capable `chrome`.

interface Event<Args extends unknown[]> {
  addListener(listener: (...args: Args) => void): void;
  removeListener(listener: (...args: Args) => void): void;
}

export interface ExtensionTab {
  id?: number;
  url?: string;
  title?: string;
}

export interface ExtensionApi {
  action: {
    onClicked: Event<[ExtensionTab]>;
  };
  tabs: {
    create(options: { url: string; active?: boolean }): Promise<ExtensionTab>;
    onUpdated: Event<[number, { status?: string; url?: string }, ExtensionTab]>;
  };
  scripting: {
    executeScript(injection: {
      target: { tabId: number };
      func?: () => unknown;
      files?: string[];
    }): Promise<Array<{ result?: unknown }>>;
  };
  runtime: {
    onMessage: Event<[unknown, unknown, (response?: unknown) => void]>;
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

export function getExtensionApi(): ExtensionApi {
  const g = globalThis as unknown as { browser?: ExtensionApi; chrome?: ExtensionApi };
  return (g.browser ?? g.chrome) as ExtensionApi;
}
