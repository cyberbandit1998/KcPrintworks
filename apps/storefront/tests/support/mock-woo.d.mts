export const MOCK_KEY: string;
export const MOCK_SECRET: string;
export const MOCK_HANDOFF_SECRET: string;
export function createMockWoo(options?: { port?: number; key?: string; secret?: string }): {
  log: {
    requests: { method: string; path: string; search: string }[];
    writes: number;
    unauthorized: number;
    wp: { method: string; path: string; search: string; credentialSent: boolean }[];
    reviews: Record<string, unknown>[];
    store: { method: string; path: string; search: string; credentialSent: boolean }[];
    core: {
      method: string;
      route: string;
      body: string;
      headers: Record<string, string | string[] | undefined>;
    }[];
  };
  readonly baseUrl: string;
  start(): Promise<string>;
  stop(): Promise<void>;
  edit(id: number, fields: Record<string, unknown>): void;
  readonly data: ReturnType<typeof import('./woo-fixture.mjs').createFixture>;
};
