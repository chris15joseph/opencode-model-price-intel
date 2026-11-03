/**
 * Live Artificial Analysis Intelligence Index fetcher.
 *
 * Scores change as Artificial Analysis publishes new evaluations (the index is
 * versioned — currently v5.0), so this runs whenever the plugin refreshes,
 * with a cached copy kept in plugin storage and periodic refresh while the
 * session is open.
 *
 * Two sources, in order:
 *
 * 1. The official Free Data API
 *    (https://artificialanalysis.ai/api/v2/language/models/free), when an API
 *    key is available (`options.aaApiKey` or the
 *    ARTIFICIALANALYSIS_API_KEY environment variable). The free endpoint
 *    accepts any valid key (Free, Pro or Commercial). Attribution:
 *    https://artificialanalysis.ai/
 *
 * 2. The public model-list page (https://artificialanalysis.ai/models), whose
 *    embedded dataset (`initialModels` records in the RSC payload) carries the
 *    `intelligenceIndex` score per model variant. Requires no key.
 *
 * The bundled snapshot in `aa-snapshot.ts` is only used when both fail, and
 * only when its major index version matches the live data.
 */

import {
  AA_INDEX_VERSION,
  AA_SNAPSHOT,
  AA_SNAPSHOT_ALIASES,
  AA_SNAPSHOT_CAPTURED_AT,
  AA_SNAPSHOT_DATE,
  AA_SNAPSHOT_VERSION,
  type AAScore,
} from "./aa-snapshot.ts"

export const AA_MODELS_URL = "https://artificialanalysis.ai/models"
/** Free-tier endpoint: accepts any valid API key; Pro-only route is not needed. */
export const AA_API_URL = "https://artificialanalysis.ai/api/v2/language/models/free"
/** Hard safety cap on API pagination (the Free quota is 100 requests/day). */
export const AA_MAX_API_PAGES = 10

const MAX_ATTEMPTS = 3
const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_RETRY_DELAY_MS = 200
const MAX_RETRY_DELAY_MS = 5_000

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
  /** True when the page did not publish a version and 5.0 was assumed. */
  versionAssumed: boolean
}

interface SourceOptions {
  timeoutMs: number
  log: AALog
  retryDelayMs: number
}

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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Coerce finite, non-negative numbers or numeric strings; reject everything else. */
function finiteNonNegative(value: unknown): number | null {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN
  return Number.isFinite(number) && number >= 0 ? number : null
}

/** Normalize AA's numeric (`5` / `5.1`) or string (`"5.0"`, `"v5"`) version. */
export function normalizeVersion(value: unknown, fallback = AA_INDEX_VERSION): string {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    const text = String(value)
    return text.includes(".") ? text : `${text}.0`
  }
  if (typeof value === "string") {
    const match = value.trim().match(/^v?(\d+)(?:\.(\d+))?/i)
    if (match) return `${match[1]}.${match[2] ?? "0"}`
  }
  return fallback
}

function optionalVersion(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined
  if (typeof value === "number" && (!Number.isFinite(value) || value < 0)) return undefined
  if (typeof value === "string" && !/^v?\d+(?:\.\d+)?/i.test(value.trim())) return undefined
  return normalizeVersion(value)
}

function majorOf(version: string): string {
  return version.split(".")[0] ?? version
}

function countNumericScores(scores: Readonly<Record<string, AAScore>>): number {
  let count = 0
  for (const entry of Object.values(scores)) if (entry.score != null) count++
  return count
}

// ------------------------------------------------------------------ page

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

function preferRecord(existing: AARecord | undefined, candidate: AARecord): boolean {
  if (!existing) return true
  if (existing.score === null && candidate.score !== null) return true
  if (existing.score !== null && candidate.score !== null) {
    const priority = variantPriority(candidate.name) - variantPriority(existing.name)
    if (priority > 0) return true
    if (priority < 0) return false
  }
  if (existing.estimated && !candidate.estimated && candidate.score !== null) return true
  return false
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

// --------------------------------------------------------------- matching

/**
 * Normalize a model name or ID into a comparison key.
 *
 * Parenthesized qualifiers ("(Max)"), the OpenCode "Free" tier marker
 * ("GLM-5.3-Flash Free", "glm-5.3-flash-free" -> "glm53flash"), and all
 * punctuation are removed so an OpenCode catalog entry finds its Artificial
 * Analysis counterpart. A trailing "free" is only removed as a whole word, so
 * names such as "Carefree" survive intact.
 */
export function matchKey(nameOrId: string): string {
  return nameOrId
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/\bfree\b/g, "")
    .replace(/[^a-z0-9]/g, "")
}

/**
 * Prefer the highest-effort variant of a model when AA scores several.
 * Plain/date entries rank below every explicit effort, and Max is highest.
 */
export function variantPriority(name: string): number {
  const qualifier = (name.match(/\(([^)]*)\)/)?.[1] ?? "").toLowerCase()
  if (/\bmax\b/.test(qualifier)) return 6
  if (/\bxhigh\b/.test(qualifier)) return 5
  if (/\bhigh\b/.test(qualifier)) return 4
  if (/\bmedium\b/.test(qualifier)) return 3
  if (/\blow\b/.test(qualifier)) return 2
  return 1 // plain entries and date qualifiers such as (0902)
}

function variantLabel(name: string): string | undefined {
  const qualifier = name.match(/\(([^)]*)\)/)?.[1]?.trim()
  return qualifier ? qualifier.toLowerCase() : undefined
}

function roundScore(score: number): number {
  return Math.round(score * 10) / 10
}

/**
 * Build a lookup keyed by `matchKey`. When a base name has several effort
 * variants, order is deterministic: Max > Xhigh > High > Medium > Low >
 * plain/date, with scored entries before unscored ties. If the highest-effort
 * entry is unscored, the result is `null` (AA n/a) with a note naming the
 * lower-effort score rather than silently presenting a low-effort number.
 */
export function indexRecords(records: readonly AARecord[]): Record<string, AAScore> {
  const grouped = new Map<string, AARecord[]>()
  for (const record of records) {
    const key = matchKey(record.name) || matchKey(record.slug)
    if (!key) continue
    const list = grouped.get(key) ?? []
    list.push(record)
    grouped.set(key, list)
  }
  const out: Record<string, AAScore> = {}
  for (const [key, list] of grouped) {
    const sorted = [...list].sort((a, b) => {
      const priority = variantPriority(b.name) - variantPriority(a.name)
      if (priority !== 0) return priority
      const scored = Number(a.score === null) - Number(b.score === null)
      if (scored !== 0) return scored
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    })
    const best = sorted[0]
    const label = variantLabel(best.name)
    if (best.score !== null) {
      out[key] = {
        score: best.score,
        name: best.name,
        note: label && label !== "max" ? `AA variant: (${label})` : undefined,
      }
      continue
    }
    const lower = sorted.find((record) => record.score !== null)
    if (lower) {
      const lowerLabel = variantLabel(lower.name) ?? "plain"
      out[key] = {
        score: null,
        name: best.name,
        note: `Not scored at (${label ?? "plain"}); lower-effort (${lowerLabel}) score ${roundScore(lower.score!)} not used`,
      }
    } else {
      out[key] = {
        score: null,
        name: best.name,
        note: label && label !== "max" ? `AA variant: (${label})` : undefined,
      }
    }
  }
  return out
}

/**
 * Look up the AA entry for an OpenCode model by model ID or display name.
 *
 * Matching is deliberately strict to avoid false positives between sibling
 * models (e.g. "Kimi K3" must never pick up "Kimi K3.1 Pro"'s score). Exact
 * keys win; a checkpoint/version suffix is considered only when there is a
 * single candidate. Generic family names ("Grok", "Claude") never absorb a
 * digit-suffixed sibling; only a whole `X.0` release such as Beam 1.0 may
 * stand in for "Beam".
 */
export function lookupScore(
  index: Readonly<Record<string, AAScore>>,
  modelID: string,
  modelName: string,
): AAScore | undefined {
  const keys = [...new Set([matchKey(modelID), matchKey(modelName)].filter((key) => key.length > 0))]
  const exactEntries: AAScore[] = []
  for (const key of keys) {
    const entry = index[key]
    if (!entry) continue
    const duplicate = exactEntries.some(
      (existing) => existing === entry || (existing.name === entry.name && existing.score === entry.score),
    )
    if (!duplicate) exactEntries.push(entry)
  }
  // ID and display name disagreeing is ambiguous: show AA n/a rather than guess.
  if (exactEntries.length > 1) return undefined
  const exact = exactEntries[0]
  if (exact?.score != null) return exact

  const candidates = new Map<string, AAScore>()
  for (const key of keys) {
    if (key.length < 4) continue
    const keyEndsInDigit = /\d$/.test(key)
    for (const [candidate, entry] of Object.entries(index)) {
      if (!candidate.startsWith(key) || candidate === key) continue
      const suffix = candidate.slice(key.length)
      if (!/^\d{1,4}$/.test(suffix)) continue
      if (keyEndsInDigit && suffix.length < 3) continue
      // A generic family name only stands in for a whole major release
      // ("Beam" -> "Beam 1.0"). "Grok" must not borrow "Grok 4.7".
      if (!keyEndsInDigit && suffix.length < 3 && !suffix.endsWith("0")) continue
      candidates.set(candidate, entry)
    }
  }
  // Multiple possible siblings are ambiguous: prefer no score over a guess.
  if (candidates.size > 1) return undefined
  const suffixed = [...candidates.values()][0]
  if (suffixed?.score != null) return suffixed
  return exact ?? suffixed
}

// --------------------------------------------------------------- snapshot

let normalizedSnapshot: Readonly<Record<string, AAScore>> | undefined

/**
 * The bundled snapshot is keyed by `matchKey(name)`. Re-normalize defensively
 * and add documented OpenCode-ID aliases (e.g. `claude-haiku-4-5`). The shared
 * index is frozen so callers cannot poison it for the rest of the process.
 */
function snapshotIndex(): Readonly<Record<string, AAScore>> {
  if (normalizedSnapshot) return normalizedSnapshot
  const out: Record<string, AAScore> = {}
  const add = (key: string, entry: AAScore) => {
    const normalized = matchKey(key) || key
    const existing = out[normalized]
    if (!existing || (existing.score == null && entry.score != null)) {
      out[normalized] = Object.freeze({ ...entry })
    }
  }
  for (const [key, entry] of Object.entries(AA_SNAPSHOT)) add(key, entry)
  for (const [alias, target] of Object.entries(AA_SNAPSHOT_ALIASES)) {
    const entry = out[matchKey(target) || target]
    // Reuse the canonical entry object so ID/name lookups are not seen as two
    // distinct candidates by `lookupScore`.
    if (entry) out[matchKey(alias) || alias] = entry
  }
  normalizedSnapshot = Object.freeze(out)
  return normalizedSnapshot
}

function mergeWithSnapshot(
  index: Readonly<Record<string, AAScore>>,
  version: string,
): { scores: Record<string, AAScore>; coverage: AACoverage } {
  const merged: Record<string, AAScore> = { ...index }
  let live = 0
  for (const entry of Object.values(index)) if (entry.score != null) live++
  let snapshot = 0
  if (majorOf(version) === majorOf(AA_SNAPSHOT_VERSION)) {
    for (const [key, entry] of Object.entries(snapshotIndex())) {
      const existing = merged[key]
      if (existing?.score != null) continue
      if (existing && entry.score == null) continue
      merged[key] = {
        score: entry.score,
        name: existing?.name ?? entry.name,
        note: entry.note ? `${entry.note} [snapshot]` : "[snapshot]",
      }
      if (entry.score != null) snapshot++
    }
  }
  return { scores: merged, coverage: { live, snapshot, total: live + snapshot } }
}

/**
 * Use the bundled snapshot to fill gaps the live data does not cover, but only
 * when the live index has the same major version. Live non-null scores always
 * win; snapshot-derived entries carry a `[snapshot]` note.
 */
export function withSnapshotFallback(
  index: Readonly<Record<string, AAScore>>,
  version: string | number = AA_INDEX_VERSION,
): Record<string, AAScore> {
  return mergeWithSnapshot(index, normalizeVersion(version)).scores
}

// ------------------------------------------------------------------ fetch

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve()
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

function parseRetryAfter(header: string | null | undefined): number | undefined {
  if (!header) return undefined
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000
  const date = Date.parse(header)
  if (Number.isFinite(date)) return Math.max(0, date - Date.now())
  return undefined
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || /abort/i.test(error.message))
}

/** One request, one fresh controller/timer. Never share an abort signal. */
async function fetchOnce(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  // Race the request as well as aborting it, so even a fetch implementation
  // that ignores the signal cannot hold up the next source forever.
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      const error = new Error(`Artificial Analysis request timed out after ${timeoutMs}ms`)
      error.name = "AbortError"
      reject(error)
    }, timeoutMs)
  })
  try {
    return await Promise.race([
      fetchImpl(input, { ...init, signal: controller.signal }),
      timeout,
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Retry 429/5xx a bounded number of times; honor Retry-After when present. */
async function fetchWithRetry(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit,
  options: SourceOptions,
): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetchOnce(fetchImpl, input, init, options.timeoutMs)
      if (response.ok || !isRetryableStatus(response.status) || attempt >= MAX_ATTEMPTS) {
        return response
      }
      const retryAfter = parseRetryAfter(response.headers?.get?.("retry-after"))
      const requestedDelay = retryAfter ?? options.retryDelayMs * 2 ** (attempt - 1)
      if (requestedDelay > MAX_RETRY_DELAY_MS) {
        options.log(
          `[model-pricing] Artificial Analysis returned ${response.status} with Retry-After ${requestedDelay}ms; not retrying (cap ${MAX_RETRY_DELAY_MS}ms)`,
        )
        return response
      }
      options.log(
        `[model-pricing] Artificial Analysis returned ${response.status}; retry ${attempt}/${MAX_ATTEMPTS - 1} in ${requestedDelay}ms`,
      )
      await sleep(requestedDelay)
    } catch (error) {
      if (isAbortError(error) || attempt >= MAX_ATTEMPTS) throw error
      const delay = Math.min(options.retryDelayMs * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS)
      options.log(
        `[model-pricing] Artificial Analysis request failed (${error instanceof Error ? error.message : String(error)}); retry ${attempt}/${MAX_ATTEMPTS - 1} in ${delay}ms`,
      )
      await sleep(delay)
    }
  }
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
    // ignore malformed next values
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
      if (!isObject(raw)) continue // skip null and non-object items
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

/**
 * Snapshot fallback used when live fetching fails. `fetchedAt` is the snapshot
 * capture date, never "now", so the command table cannot present stale data as
 * freshly fetched.
 */
export function snapshotScores(): AAFetched {
  const scores = Object.freeze({ ...snapshotIndex() })
  const scored = countNumericScores(scores)
  return {
    scores,
    version: AA_SNAPSHOT_VERSION,
    source: `bundled snapshot (artificialanalysis.ai, ${AA_SNAPSHOT_DATE})`,
    fetchedAt: AA_SNAPSHOT_CAPTURED_AT,
    coverage: { live: 0, snapshot: scored, total: scored },
  }
}
