import { AA_INDEX_VERSION } from "./aa-snapshot.ts"
import type { AAPageFetch, AARecord, SourceOptions } from "./aa-types.ts"
import { DEFAULT_RETRY_DELAY_MS, DEFAULT_TIMEOUT_MS, fetchWithRetry } from "./aa-http.ts"
import { preferRecord } from "./aa-match.ts"
import { finiteNonNegative, isObject, normalizeVersion } from "./aa-util.ts"

export const AA_MODELS_URL = "https://artificialanalysis.ai/models"

/** Decode the escaped JSON-string payloads in `self.__next_f.push([1,"..."])`. */
export function decodeRSC(html: string): string {
  let result = ""
  const re = /self\.__next_f\.push\(\s*\[\s*1\s*,\s*"/g
  let match: RegExpExecArray | null
  while ((match = re.exec(html)) !== null) {
    let i = re.lastIndex // just after the opening quote
    let raw = ""
    while (i < html.length) {
      const ch = html[i]
      if (ch === "\\") {
        raw += html.slice(i, i + 2)
        i += 2
        continue
      }
      if (ch === '"') break
      raw += ch
      i++
    }
    try {
      result += JSON.parse(`"${raw}"`) as string
    } catch {
      result += raw
    }
    re.lastIndex = i + 1
  }
  return result
}

/**
 * Company aggregate rows on AA's evaluations pages are shaped like model
 * records. The fallback only reads the model-list page, but filter these
 * explicitly as a second line of defence.
 */
const COMPANY_AGGREGATES = new Set([
  "google",
  "googledeepmind",
  "anthropic",
  "openai",
  "meta",
  "metaai",
  "kimi",
  "moonshot",
  "moonshotai",
  "spacexai",
  "xai",
  "alibaba",
  "alibabacloud",
  "deepseek",
  "mistral",
  "mistralai",
  "nvidia",
  "microsoft",
  "amazon",
  "apple",
  "bytedance",
  "baidu",
  "tencent",
  "minimax",
  "stepfun",
  "zai",
])

function keyForCompany(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase().replace(/[^a-z0-9]/g, "") : ""
}

function isCompanyAggregate(record: Record<string, unknown>): boolean {
  if (COMPANY_AGGREGATES.has(keyForCompany(record.name))) return true
  if (COMPANY_AGGREGATES.has(keyForCompany(record.slug))) return true
  // Brand rows carry a colour/logo but none of the model-only fields.
  const looksLikeBrand = "color" in record || "logo" in record
  const looksLikeModel =
    "shortName" in record ||
    "suffix" in record ||
    "releaseDate" in record ||
    "effort" in record ||
    "release" in record
  return looksLikeBrand && !looksLikeModel
}

/**
 * Extract balanced `{...}` JSON objects starting at `start`, respecting
 * escaped quotes inside strings. This keeps schema parsing independent of
 * field order and record length.
 */
function balancedObjectAt(text: string, start: number): string | undefined {
  if (text[start] !== "{") return undefined
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === "\\") {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
    } else if (ch === "{") {
      depth++
    } else if (ch === "}") {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return undefined
}

function recordScore(record: Record<string, unknown>): number | null {
  // Model-list records use `intelligenceIndex`; accept the API-shaped
  // evaluation field too so both payloads share one parser.
  if ("intelligenceIndex" in record) return finiteNonNegative(record.intelligenceIndex)
  const evaluations = isObject(record.evaluations) ? record.evaluations : undefined
  return finiteNonNegative(evaluations?.artificial_analysis_intelligence_index)
}

/**
 * Extract `initialModels`-style records from a decoded RSC payload. Records
 * are parsed as balanced JSON objects, so escaped quotes, reordered fields and
 * long records are handled; malformed/negative scores become `null` rather
 * than `NaN` or a borrowed sibling score.
 */
export function parseAARecords(payload: string): AARecord[] {
  const decoded = payload.includes("self.__next_f.push") ? decodeRSC(payload) : payload
  const records = new Map<string, AARecord>()
  // Any object start; JSON.parse tells us whether it is a real record. This
  // keeps field order and whitespace from mattering.
  const starts = /\{\s*(?="[A-Za-z_][A-Za-z0-9_]*"\s*:)/g
  let start: RegExpExecArray | null
  while ((start = starts.exec(decoded)) !== null) {
    const raw = balancedObjectAt(decoded, start.index)
    if (!raw) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      continue // invalid JSON (NaN, 1.2.3, unescaped junk) never scores
    }
    if (!isObject(parsed)) continue
    const hasScoreField = "intelligenceIndex" in parsed || "intelligenceIndexIsEstimated" in parsed
    // Keep a model record with a missing score (AA n/a) instead of dropping it;
    // nested `release` objects and unrelated payloads lack these model fields.
    const hasModelShape =
      "shortName" in parsed ||
      "suffix" in parsed ||
      "releaseDate" in parsed ||
      "effort" in parsed
    const hasModelIdentity =
      typeof parsed.id === "string" &&
      typeof parsed.slug === "string" &&
      typeof parsed.name === "string"
    if (!hasScoreField && !hasModelShape && !hasModelIdentity) continue
    if (isCompanyAggregate(parsed)) continue
    const name = typeof parsed.name === "string" ? parsed.name.trim() : ""
    const slug = typeof parsed.slug === "string" ? parsed.slug.trim() : ""
    if (!name && !slug) continue
    const record: AARecord = {
      slug: slug || name,
      name: name || slug,
      score: recordScore(parsed),
      estimated: parsed.intelligenceIndexIsEstimated === true,
    }
    const key = slug || name
    if (preferRecord(records.get(key), record)) records.set(key, record)
  }
  return [...records.values()]
}

/** Version embedded in the public page payload, if it publishes one. */
export function parsePageVersion(payload: string): string | undefined {
  const decoded = payload.includes("self.__next_f.push") ? decodeRSC(payload) : payload
  const patterns = [
    /"intelligenceIndexVersion"\s*:\s*"?v?(\d+(?:\.\d+)?)"?/i,
    /"intelligence_index_version"\s*:\s*"?v?(\d+(?:\.\d+)?)"?/i,
    /"indexVersion"\s*:\s*"?v?(\d+(?:\.\d+)?)"?/i,
  ]
  for (const pattern of patterns) {
    const match = decoded.match(pattern)
    if (match) return normalizeVersion(match[1])
  }
  return undefined
}

/**
 * Scrape the embedded dataset from the public model-list page (no key needed).
 * Only the model-list page is used: the evaluations page contains company
 * aggregate rows and must never be treated as a model source.
 */
export async function fetchFromPages(
  fetchImpl: typeof fetch = fetch,
  options?: Partial<SourceOptions>,
): Promise<AAPageFetch> {
  const settings: SourceOptions = {
    timeoutMs: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    log: options?.log ?? ((message) => console.warn(message)),
    retryDelayMs: options?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
  }
  const response = await fetchWithRetry(fetchImpl, AA_MODELS_URL, {}, settings)
  if (!response.ok) throw new Error(`Artificial Analysis model page returned ${response.status}`)
  const html = await response.text()
  const decoded = decodeRSC(html)
  const records = parseAARecords(decoded)
  const pageVersion = parsePageVersion(decoded)
  return {
    records,
    version: pageVersion ?? AA_INDEX_VERSION,
    versionAssumed: pageVersion === undefined,
  }
}
