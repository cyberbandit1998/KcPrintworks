export const MOCK_KEY: string;
export const MOCK_SECRET: string;
export function createMockWoo(options?: { port?: number; key?: string; secret?: string }): {
  log: {
    requests: { method: string; path: string; search: string }[];
    writes: number;
    unauthorized: number;
  };
  readonly baseUrl: string;
  start(): Promise<string>;
  stop(): Promise<void>;
  edit(id: number, fields: Record<string, unknown>): void;
  readonly data: ReturnType<typeof import('./woo-fixture.mjs').createFixture>;
};
