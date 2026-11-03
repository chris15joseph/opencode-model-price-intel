/**
 * Artificial Analysis Intelligence Index fetcher.
 *
 * Scores are versioned and refresh with the plugin. The Free Data API is tried
 * when a key is configured, then the public model-list page, then the bundled
 * snapshot. Attribution: https://artificialanalysis.ai/
 */

import {
  AA_API_URL,
  AA_MAX_API_PAGES,
  fetchFromAPI,
} from "./aa-api.ts"
import { DEFAULT_RETRY_DELAY_MS, DEFAULT_TIMEOUT_MS } from "./aa-http.ts"
import {
  indexRecords,
  lookupScore,
  matchKey,
  mergeWithSnapshot,
  snapshotScores,
  variantPriority,
  withSnapshotFallback,
} from "./aa-match.ts"
import {
  AA_MODELS_URL,
  decodeRSC,
  fetchFromPages,
  parseAARecords,
  parsePageVersion,
} from "./aa-page.ts"
import type { AAFetchOptions, AAFetched, SourceOptions } from "./aa-types.ts"
import { normalizeVersion } from "./aa-util.ts"

export { AA_API_URL, AA_MAX_API_PAGES, fetchFromAPI }
export { AA_MODELS_URL, decodeRSC, fetchFromPages, parseAARecords, parsePageVersion }
export {
  indexRecords,
  lookupScore,
  matchKey,
  snapshotScores,
  variantPriority,
  withSnapshotFallback,
}
export { normalizeVersion }
export type {
  AAAPIFetch,
  AACoverage,
  AAFetchOptions,
  AAFetched,
  AALog,
  AAPageFetch,
  AARecord,
} from "./aa-types.ts"

/**
 * Fetch current Intelligence Index scores. Tries the Free API when a key is
 * configured, then the public model-list page, then falls back to the bundled
 * snapshot. Every source completes before the snapshot is used, so a stalled
 * API cannot consume the page fallback's abort budget.
 */
export async function fetchAAScores(options?: AAFetchOptions): Promise<AAFetched> {
  const fetchImpl = options?.fetchImpl ?? fetch
  const apiKey = options?.apiKey ?? process.env.ARTIFICIALANALYSIS_API_KEY
  const log = options?.log ?? ((message) => console.warn(message))
  const settings: SourceOptions = {
    timeoutMs: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    log,
    retryDelayMs: options?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
  }

  if (apiKey) {
    try {
      const { records, version, pages } = await fetchFromAPI(apiKey, fetchImpl, settings)
      if (records.length > 0) {
        const { scores, coverage } = mergeWithSnapshot(indexRecords(records), version)
        log(
          `[model-pricing] AA API (${pages} page${pages === 1 ? "" : "s"}): ${coverage.live} live + ${coverage.snapshot} snapshot scores`,
        )
        return {
          scores,
          version,
          source: "artificialanalysis.ai Data API",
          fetchedAt: new Date().toISOString(),
          coverage,
        }
      }
      log("[model-pricing] AA API returned no usable model records; falling back to the model page")
    } catch (error) {
      log(
        `[model-pricing] AA API failed (${error instanceof Error ? error.message : String(error)}); falling back to the model page`,
      )
    }
  }

  try {
    const page = await fetchFromPages(fetchImpl, settings)
    if (page.records.length > 0) {
      const { scores, coverage } = mergeWithSnapshot(indexRecords(page.records), page.version)
      const source = page.versionAssumed
        ? `artificialanalysis.ai model pages; assumed ${page.version} (page)`
        : "artificialanalysis.ai model pages"
      log(
        `[model-pricing] AA model page (v${page.version}${page.versionAssumed ? " assumed" : ""}): ${coverage.live} live + ${coverage.snapshot} snapshot scores`,
      )
      return {
        scores,
        version: page.version,
        source,
        fetchedAt: new Date().toISOString(),
        coverage,
      }
    }
    log("[model-pricing] AA model page contained no model records")
  } catch (error) {
    log(
      `[model-pricing] AA model page failed (${error instanceof Error ? error.message : String(error)}); using bundled snapshot`,
    )
  }

  throw new Error("no Artificial Analysis data could be fetched")
}
