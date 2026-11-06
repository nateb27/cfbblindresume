/**
 * The small slice of the Cloudflare Pages Functions runtime these Functions use, typed locally so
 * the code type-checks under the repo's root tsconfig (DOM lib) without pulling in a second global
 * type library. Only what is used is declared.
 */

/** Result of a D1 query (`all`, `run`, each `batch` entry). */
export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta?: Record<string, unknown>;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  /** Runs the statements in order inside one transaction. */
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

/** The static-asset binding Pages gives every Function. */
export interface AssetFetcher {
  fetch(input: Request | URL | string, init?: RequestInit): Promise<Response>;
}

/** Bindings and variables (wrangler.toml + dashboard secrets). */
export interface Env {
  /** D1 database "cfbblindresume" (migrations/). Absent on deployments without the binding. */
  DB?: D1Database;
  ASSETS: AssetFetcher;
  /** Secret salt for hashing IPs (rate limiting). Rotated daily by mixing in the UTC date. */
  IP_SALT?: string;
  PUBLIC_ADS?: string;
}

/** The context object Pages passes to `onRequest*`. */
export interface PagesContext<P extends string = string> {
  request: Request;
  env: Env;
  params: Record<P, string | string[]>;
  waitUntil(promise: Promise<unknown>): void;
  next(input?: Request | string, init?: RequestInit): Promise<Response>;
  data: Record<string, unknown>;
}

export type PagesHandler<P extends string = string> = (context: PagesContext<P>) => Response | Promise<Response>;

/** `caches.default` (the zone cache). A no-op on *.pages.dev; null where the Cache API is missing. */
export function defaultCache(): Cache | null {
  const c = (globalThis as { caches?: { default?: Cache } }).caches;
  return c?.default ?? null;
}

/** Minimal HTMLRewriter surface (workerd global). */
export interface HTMLElementLike {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): HTMLElementLike;
  setInnerContent(content: string, options?: { html?: boolean }): HTMLElementLike;
  after(content: string, options?: { html?: boolean }): HTMLElementLike;
}

export interface HTMLRewriterLike {
  on(selector: string, handlers: { element?(el: HTMLElementLike): void }): HTMLRewriterLike;
  transform(response: Response): Response;
}

/** The workerd HTMLRewriter constructor, or null outside workerd (Node tests). */
export function htmlRewriter(): (new () => HTMLRewriterLike) | null {
  return (globalThis as { HTMLRewriter?: new () => HTMLRewriterLike }).HTMLRewriter ?? null;
}

/** First value of a route param ("[code]" gives a string; "[[path]]" an array). */
export function param(ctx: { params: Record<string, string | string[]> }, name: string): string {
  const v = ctx.params[name];
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}
