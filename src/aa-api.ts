import { AA_INDEX_VERSION } from "./aa-snapshot.ts"
import type { AAAPIFetch, AARecord, SourceOptions } from "./aa-types.ts"
import { DEFAULT_RETRY_DELAY_MS, DEFAULT_TIMEOUT_MS, fetchWithRetry } from "./aa-http.ts"
import { preferRecord } from "./aa-match.ts"
import { finiteNonNegative, isObject, normalizeVersion } from "./aa-util.ts"

/** Free-tier endpoint: accepts any valid API key; Pro-only route is not needed. */
export const AA_API_URL = "https://artificialanalysis.ai/api/v2/language/models/free"
/** Hard safety cap on API pagination (the Free quota is 100 requests/day). */
export const AA_MAX_API_PAGES = 10

function optionalVersion(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined
  if (typeof value === "number" && (!Number.isFinite(value) || value < 0)) return undefined
  if (typeof value === "string" && !/^v?\d+(?:\.\d+)?/i.test(value.trim())) return undefined
  return normalizeVersion(value)
}

function pageFromNext(next: unknown): number | undefined {
  if (typeof next === "number" && Number.isInteger(next) && next > 0) return next
  if (typeof next !== "string" || next.trim() === "") return undefined
  if (/^\d+$/.test(next.trim())) return Number(next)
  try {
    const url = new URL(next, AA_API_URL)
    const page = Number(url.searchParams.get("page"))
    if (Number.isInteger(page) && page > 0) return page
  } catch {
    return undefined
  }
  return undefined
}

function integerOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined
}

function apiScore(item: Record<string, unknown>): number | null {
  const evaluations = isObject(item.evaluations) ? item.evaluations : undefined
  for (const candidate of [
    item.artificial_analysis_intelligence_index,
    evaluations?.artificial_analysis_intelligence_index,
  ]) {
    const score = finiteNonNegative(candidate)
    if (score !== null) return score
  }
  return null
}

/**
 * Fetch scores from the Free Data API. Pages until `has_more`/`total_pages`/
 * `next` says to stop, with a hard cap. A later-page failure keeps the records
 * already collected instead of discarding page 1. Exported for tests and the
 * snapshot regeneration script.
 */
export async function fetchFromAPI(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  options?: Partial<SourceOptions>,
): Promise<AAAPIFetch> {
  const settings: SourceOptions = {
    timeoutMs: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    log: options?.log ?? ((message) => console.warn(message)),
    retryDelayMs: options?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
  }
  const bySlug = new Map<string, AARecord>()
  let version = AA_INDEX_VERSION
  let page = 1
  let pages = 0

  while (page >= 1 && page <= AA_MAX_API_PAGES) {
    const url = `${AA_API_URL}?page=${page}`
    pages++
    let response: Response
    try {
      response = await fetchWithRetry(
        fetchImpl,
        url,
        { headers: { "x-api-key": apiKey } },
        settings,
      )
    } catch (error) {
      if (page === 1) throw error
      settings.log(
        `[model-pricing] Artificial Analysis API page ${page} failed (${error instanceof Error ? error.message : String(error)}); keeping ${bySlug.size} records from earlier pages`,
      )
      break
    }
    if (!response.ok) {
      if (page === 1) throw new Error(`AA API returned ${response.status}`)
      settings.log(
        `[model-pricing] Artificial Analysis API page ${page} returned ${response.status}; keeping ${bySlug.size} records from earlier pages`,
      )
      break
    }

    let body: unknown
    try {
      body = await response.json()
    } catch {
      if (page === 1) throw new Error("AA API returned invalid JSON")
      settings.log(`[model-pricing] Artificial Analysis API page ${page} was not JSON; keeping earlier pages`)
      break
    }
    if (!isObject(body)) {
      if (page === 1) throw new Error("AA API returned a non-object body")
      settings.log(`[model-pricing] Artificial Analysis API page ${page} had an invalid shape; keeping earlier pages`)
      break
    }
    if (!Array.isArray(body.data)) {
      if (page === 1) throw new Error("AA API response data is not an array")
      settings.log(`[model-pricing] Artificial Analysis API page ${page} had no data array; keeping earlier pages`)
      break
    }

    const pageVersion = optionalVersion(body.intelligence_index_version)
    if (pageVersion) version = pageVersion

    for (const raw of body.data) {
      if (!isObject(raw)) continue
      const slug =
        typeof raw.slug === "string" && raw.slug !== ""
          ? raw.slug
          : typeof raw.id === "string"
            ? raw.id
            : ""
      const name = typeof raw.name === "string" && raw.name !== "" ? raw.name : slug
      if (!slug && !name) continue
      const record: AARecord = {
        slug: slug || name,
        name: name || slug,
        score: apiScore(raw),
        estimated: false,
      }
      const key = record.slug
      if (preferRecord(bySlug.get(key), record)) bySlug.set(key, record)
    }

    const pagination = isObject(body.pagination) ? body.pagination : undefined
    const totalPages = integerOrUndefined(pagination?.total_pages)
    const hasMore = typeof pagination?.has_more === "boolean" ? pagination.has_more : undefined
    const nextPage = pageFromNext(pagination?.next)

    if (body.data.length === 0) break
    if (totalPages !== undefined && page >= totalPages) break
    if (hasMore === false) break
    if (nextPage === undefined && totalPages === undefined && hasMore === undefined) break
    const target = nextPage ?? page + 1
    if (target <= page) break
    if (target > AA_MAX_API_PAGES) {
      settings.log(
        `[model-pricing] Artificial Analysis pagination stopped at the ${AA_MAX_API_PAGES}-page safety cap`,
      )
      break
    }
    page = target
  }

  return { records: [...bySlug.values()], version, pages }
}
