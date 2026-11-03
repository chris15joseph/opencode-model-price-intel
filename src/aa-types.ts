import type { AAScore } from "./aa-snapshot.ts"

export interface AARecord {
  slug: string
  name: string
  score: number | null
  estimated: boolean
}

/** Where the numeric scores in a merged result came from. */
export interface AACoverage {
  live: number
  snapshot: number
  total: number
}

export interface AAFetched {
  /** Keyed by normalized base name / model ID (see `matchKey`). */
  scores: Readonly<Record<string, AAScore>>
  version: string
  source: string
  fetchedAt: string
  /** Counts of numeric scores supplied by the live source vs the snapshot. */
  coverage?: AACoverage
}

export type AALog = (message: string) => void

export interface AAFetchOptions {
  apiKey?: string
  fetchImpl?: typeof fetch
  /** Per-request timeout. Each source/attempt gets a fresh controller. */
  timeoutMs?: number
  /** Diagnostics sink (defaults to console.warn). Never receives the API key. */
  log?: AALog
  /** Base backoff for 429/5xx retries; exposed for tests. */
  retryDelayMs?: number
}

export interface AAAPIFetch {
  records: AARecord[]
  version: string
  pages: number
}

export interface AAPageFetch {
  records: AARecord[]
  version: string
  /** True when the page did not publish a version and the bundled version was assumed. */
  versionAssumed: boolean
}

export interface SourceOptions {
  timeoutMs: number
  log: AALog
  retryDelayMs: number
}
