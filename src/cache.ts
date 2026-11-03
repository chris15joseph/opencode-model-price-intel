import type { AAFetched } from "./aa.ts"

export const CACHE_KEY = "aa-scores/v3"
/** Refuse absurdly old cache entries even if refreshHours is configured high. */
export const MAX_CACHE_AGE_MS = 30 * 24 * 60 * 60_000

function isScoreEntry(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const entry = value as Record<string, unknown>
  if (!("score" in entry)) return false
  if (
    entry.score !== null &&
    (typeof entry.score !== "number" || !Number.isFinite(entry.score))
  ) {
    return false
  }
  if (typeof entry.name !== "string") return false
  if (entry.note !== undefined && typeof entry.note !== "string") return false
  return true
}

/** Validate a cached `AAFetched` before trusting any part of it. */
export function isAAFetched(value: unknown): value is AAFetched {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const cached = value as Record<string, unknown>
  if (
    cached.scores === null ||
    typeof cached.scores !== "object" ||
    Array.isArray(cached.scores) ||
    Object.keys(cached.scores as object).length === 0
  ) {
    return false
  }
  if (typeof cached.version !== "string" || cached.version.length === 0) return false
  if (typeof cached.source !== "string" || cached.source.length === 0) return false
  if (typeof cached.fetchedAt !== "string") return false
  const fetchedAt = Date.parse(cached.fetchedAt)
  if (!Number.isFinite(fetchedAt)) return false
  // A future timestamp can otherwise pin the cache far past refreshHours.
  if (fetchedAt > Date.now()) return false
  if (Date.now() - fetchedAt > MAX_CACHE_AGE_MS) return false
  return Object.values(cached.scores as Record<string, unknown>).every(isScoreEntry)
}

/**
 * Comparison key that ignores `fetchedAt`: adopting a cache/fetch with the
 * same scores, version and source does not need a model-registry reload.
 */
export function dataSignature(value: AAFetched): string {
  const entries = Object.keys(value.scores)
    .sort()
    .map((key) => {
      const entry = value.scores[key]
      return [key, entry.score, entry.name, entry.note ?? ""]
    })
  return JSON.stringify([value.version, value.source, entries])
}

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { readonly [key: string]: JsonValue }

/** Build a plain JSON value for `ctx.storage.set` (AAFetched has no index sig). */
export function cachePayload(value: AAFetched): JsonValue {
  const scores: Record<string, JsonValue> = {}
  for (const [key, entry] of Object.entries(value.scores)) {
    const score: Record<string, JsonValue> = { score: entry.score, name: entry.name }
    if (entry.note !== undefined) score.note = entry.note
    scores[key] = score
  }
  return {
    scores,
    version: value.version,
    source: value.source,
    fetchedAt: value.fetchedAt,
  }
}
