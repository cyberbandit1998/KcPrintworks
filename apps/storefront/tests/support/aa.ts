import { expect, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Helpers for the address autocomplete plugin's browser tests (wordpress/kcpw-address-autocomplete).
 *
 * The pages are STAND-INS (a plain form, a classic checkout, a Checkout Block built with real React) and Google is a STAND-IN served
 * to the plugin's own loader (tests/fixture/google-standin.js). The plugin's script and stylesheet are the real shipped files and the
 * page configuration is the real output of the plugin's PHP. See the fixture files for what each stand-in does and does not prove.
 */
const PLUGIN = path.resolve(process.cwd(), '../../wordpress/kcpw-address-autocomplete');
const FIXTURE = path.join(PLUGIN, 'tests', 'fixture');

let built: string | null = null;
/** Builds the fixtures once per test process into a temporary folder. */
export function fixtureDir(): string {
  if (built && existsSync(built)) return built;
  built = mkdtempSync(path.join(tmpdir(), 'kcpw-aa-'));
  execFileSync('node', [path.join(FIXTURE, 'build-fixtures.mjs'), built], { stdio: 'pipe' });
  return built;
}

/** The page globals the stand-in pages and the plugin share with the tests (typed here once, so the specs need no casts). */
declare global {
  interface Window {
    KCPW_AA: Config;
    __KCPW_G: Scenario & {
      calls?: { loads: number; suggest: Suggestion[]; details: Details[]; tokens: number };
    };
    __filled: number;
    __placed?: number;
    __store: {
      shipping: Address;
      billing: Address;
      same: boolean;
      rates: unknown;
      changes: number;
    };
    __jq: { triggers: { name: string; on: string }[] };
    __pwned?: number;
    __escapes: number;
    __paymentMutations: number;
    __paymentEvents: number;
    __frame: HTMLElement | null;
    google?: unknown;
  }
}

export interface Address {
  country: string;
  state: string;
  city: string;
  postcode: string;
  address_1: string;
  address_2: string;
  first_name: string;
  last_name: string;
}
export interface Suggestion {
  input: string;
  token?: number;
  regions?: string[];
  types?: string[];
  language?: string;
}
export interface Details {
  id: string;
  fields: string[];
  token?: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- the plugin's page configuration is a free-form JSON document the specs edit freely */
export type Config = Record<string, any>;

export function config(name: 'block' | 'classic' | 'plain' | 'preview'): Config {
  return JSON.parse(readFileSync(path.join(FIXTURE, `config-${name}.json`), 'utf8'));
}

const STANDIN = readFileSync(path.join(FIXTURE, 'google-standin.js'), 'utf8');

function result(placeId: string, main: string, secondary: string, typed: number, types?: string[]) {
  return {
    placeId,
    main,
    secondary,
    matches: [{ startOffset: 0, endOffset: Math.min(typed, main.length) }],
    types,
  };
}

/** What the Google stand-in knows. Address parts are written the way Google structures them. */
export function defaultScenario(): Scenario {
  return {
    places: {
      p_main: {
        components: [
          ['street_number', '123'],
          ['route', 'Main Street'],
          ['locality', 'Flint'],
          ['administrative_area_level_2', 'Genesee County'],
          ['administrative_area_level_1', 'Michigan', 'MI'],
          ['country', 'United States', 'US'],
          ['postal_code', '48502'],
          ['postal_code_suffix', '1234'],
        ],
        formatted: '123 Main Street, Flint, MI 48502, USA',
        lat: 43.0125,
        lng: -83.6875,
      },
      p_main2: {
        components: [
          ['street_number', '123'],
          ['route', 'Main Street'],
          ['locality', 'Dallas'],
          ['administrative_area_level_1', 'Texas', 'TX'],
          ['country', 'United States', 'US'],
          ['postal_code', '75201'],
        ],
        formatted: '123 Main Street, Dallas, TX 75201, USA',
        lat: 32.78,
        lng: -96.8,
      },
      p_apt: {
        components: [
          ['street_number', '456'],
          ['route', 'Oak Avenue'],
          ['subpremise', '4'],
          ['locality', 'Austin'],
          ['administrative_area_level_1', 'Texas', 'TX'],
          ['country', 'United States', 'US'],
          ['postal_code', '78701'],
        ],
        formatted: '456 Oak Avenue #4, Austin, TX 78701, USA',
        lat: 30.27,
        lng: -97.74,
      },
      p_ca: {
        components: [
          ['street_number', '123'],
          ['route', 'King Street West'],
          ['locality', 'Toronto'],
          ['administrative_area_level_1', 'Ontario', 'ON'],
          ['country', 'Canada', 'CA'],
          ['postal_code', 'M5H 1A1'],
        ],
        formatted: '123 King St W, Toronto, ON M5H 1A1, Canada',
        lat: 43.65,
        lng: -79.38,
      },
      p_gb: {
        components: [
          ['street_number', '10'],
          ['route', 'Downing Street'],
          ['postal_town', 'London'],
          ['administrative_area_level_2', 'Greater London'],
          ['administrative_area_level_1', 'England', 'ENG'],
          ['country', 'United Kingdom', 'GB'],
          ['postal_code', 'SW1A 2AA'],
        ],
        formatted: '10 Downing St, London SW1A 2AA, UK',
        lat: 51.5,
        lng: -0.12,
      },
      p_de: {
        components: [
          ['route', 'Hauptstraße'],
          ['street_number', '12'],
          ['locality', 'Berlin'],
          ['administrative_area_level_1', 'Berlin', 'BE'],
          ['country', 'Germany', 'DE'],
          ['postal_code', '10115'],
        ],
        formatted: 'Hauptstraße 12, 10115 Berlin, Germany',
        lat: 52.52,
        lng: 13.4,
      },
    },
    rules: [
      {
        prefix: '123 ma',
        results: [
          result('p_main', '123 Main Street', 'Flint, MI, USA', 6),
          result('p_main2', '123 Main Street', 'Dallas, TX, USA', 6),
        ],
      },
      { prefix: '456', results: [result('p_apt', '456 Oak Avenue #4', 'Austin, TX, USA', 3)] },
      {
        prefix: '123 king',
        results: [result('p_ca', '123 King Street West', 'Toronto, ON, Canada', 8)],
      },
      { prefix: '10 down', results: [result('p_gb', '10 Downing Street', 'London, UK', 7)] },
      { prefix: 'haupt', results: [result('p_de', 'Hauptstraße 12', 'Berlin, Germany', 5)] },
      { prefix: 'zzz', results: [] },
    ],
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */

export interface Result {
  placeId: string;
  main: string;
  secondary: string;
  text?: string;
  matches?: { startOffset: number; endOffset: number }[];
  types?: string[];
}
export interface Rule {
  prefix: string;
  delay?: number;
  results: Result[];
}
export interface PlaceData {
  components: string[][];
  formatted: string;
  lat: number;
  lng: number;
}
/** What the Google stand-in is told to know and to do (see tests/fixture/google-standin.js). */
export interface Scenario {
  places: Record<string, PlaceData>;
  rules: Rule[];
  delay?: number;
  detailsDelay?: number;
  failSuggest?: string;
  failDetails?: boolean;
  authFailure?: boolean;
  noImportLibrary?: boolean;
  geocodeDelay?: number;
  failGeocode?: string;
}

export interface OpenOptions {
  config?: Config | ((c: Config) => Config);
  scenario?: Partial<Scenario>;
  query?: string;
  width?: number;
  height?: number;
  dark?: boolean;
  rtl?: boolean;
  /** Do not answer the Google script at all (a blocked or failing network) */
  blockGoogle?: boolean;
}

export interface Opened {
  googleLoads: () => number;
}

/** Opens one of the stand-in pages with the plugin configured and the Google stand-in answering. */
export async function open(
  page: Page,
  name: 'block' | 'classic' | 'generic',
  options: OpenOptions = {},
): Promise<Opened> {
  const base = options.config ?? config(name === 'generic' ? 'plain' : name);
  const cfg = typeof base === 'function' ? base(config(name === 'generic' ? 'plain' : name)) : base;
  const scenario = { ...defaultScenario(), ...(options.scenario ?? {}) };
  let loads = 0;

  await page.setViewportSize({ width: options.width ?? 1280, height: options.height ?? 900 });
  await page.route('https://maps.googleapis.com/**', async (route) => {
    loads += 1;
    if (options.blockGoogle) {
      await route.abort('failed');
      return;
    }
    await route.fulfill({ status: 200, contentType: 'text/javascript', body: STANDIN });
  });
  await page.addInitScript(
    ({ cfg, scenario, dark, rtl }) => {
      window.KCPW_AA = cfg;
      window.__KCPW_G = scenario;
      window.__filled = 0;
      document.addEventListener('kcpw-aa:filled', () => (window.__filled += 1), true);
      document.addEventListener('DOMContentLoaded', () => {
        if (dark) document.body.classList.add('dark');
        if (rtl) document.documentElement.setAttribute('dir', 'rtl');
      });
    },
    { cfg, scenario, dark: !!options.dark, rtl: !!options.rtl },
  );
  const file = path.join(fixtureDir(), `${name}.html`);
  await page.goto(pathToFileURL(file).href + (options.query ?? ''));
  return { googleLoads: () => loads };
}

/** Types like a person (a short pause between keys, shorter than the debounce). */
export async function type(input: Locator, text: string, delay = 25) {
  await input.click();
  await input.pressSequentially(text, { delay });
}

export const list = (page: Page) => page.locator('#kcpw-aa-listbox');
export const options = (page: Page) => page.locator('#kcpw-aa-listbox [role="option"]');

/** What the Google stand-in recorded. */
export async function calls(
  page: Page,
): Promise<{ loads: number; suggest: Suggestion[]; details: Details[]; tokens: number }> {
  // Before the stand-in script has run there is nothing recorded yet.
  return page.evaluate(
    () => window.__KCPW_G.calls ?? { loads: 0, suggest: [], details: [], tokens: 0 },
  );
}

export async function waitForSuggestions(page: Page, count?: number) {
  // The list element stays in the page (hidden) between uses, so wait for it to be SHOWN before counting its rows.
  await expect(page.locator('#kcpw-aa-dd')).toBeVisible();
  if (count === undefined) {
    await expect(options(page).first()).toBeVisible();
  } else {
    await expect(options(page)).toHaveCount(count);
  }
}

/** Waits until the plugin has finished filling a chosen address `times` times (the fields are written one at a time, so wait for the last). */
export async function filled(page: Page, times = 1) {
  await expect.poll(() => page.evaluate(() => window.__filled), { timeout: 10000 }).toBe(times);
}
