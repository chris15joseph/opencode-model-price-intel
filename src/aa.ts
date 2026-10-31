/**
 * Live Artificial Analysis Intelligence Index fetcher.
 *
 * Scores change as Artificial Analysis publishes new evaluations (the index is
 * versioned — currently v5.0), so this runs every time OpenCode loads the
 * plugin (before a coding session starts), with a cached copy kept in plugin
 * storage and periodic refresh while the session is open.
 *
 * Two sources, in order:
 *
 * 1. The official free Data API (https://artificialanalysis.ai/data-api/docs)
 *    when an API key is available (`options.aaApiKey` or the
 *    ARTIFICIALANALYSIS_API_KEY environment variable). Attribution:
 *    https://artificialanalysis.ai/
 *
 * 2. The public model pages (https://artificialanalysis.ai/models), whose
 *    embedded dataset (`initialModels` records in the RSC payload) carries the
 *    `intelligenceIndex` score per model variant. Requires no key.
 *
 * The bundled snapshot in `aa-snapshot.ts` is only used when both fail.
 */

import { AA_INDEX_VERSION, AA_SNAPSHOT, type AAScore } from "./aa-snapshot.ts"

export const AA_MODELS_URL = "https://artificialanalysis.ai/models"
export const AA_API_URL = "https://artificialanalysis.ai/api/v2/language/models"

export interface AARecord {
  slug: string
  name: string
  score: number | null
  estimated: boolean
}

export interface AAFetched {
  /** Keyed by normalized base name / model ID (see `matchKey`). */
  scores: Readonly<Record<string, AAScore>>
  version: string
  source: string
  fetchedAt: string
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

/**
 * Extract `initialModels`-style records from a decoded RSC payload:
 * each record starts `{"id":"...","slug":"...","name":"..."` and later carries
 * `"intelligenceIndex":<number|null>` plus `"intelligenceIndexIsEstimated"`.
 */
export function parseAARecords(decoded: string): AARecord[] {
  const records = new Map<string, AARecord>()
  const startRe = /\{"id":"[^"]*","slug":"([^"]+)","name":"([^"]+)"/g
  let start: RegExpExecArray | null
  while ((start = startRe.exec(decoded)) !== null) {
    const [, slug, name] = start
    const tail = decoded.slice(startRe.lastIndex, startRe.lastIndex + 3_000)
    const scoreMatch = tail.match(/"intelligenceIndex":(null|[0-9.]+)/)
    if (!scoreMatch || scoreMatch.index === undefined) continue
    // Never let a match cross into the next record.
    if (/\{"id":/.test(tail.slice(0, scoreMatch.index))) continue
    const estimated = /"intelligenceIndexIsEstimated":true/.test(
      tail.slice(scoreMatch.index, scoreMatch.index + 80),
    )
    const record: AARecord = {
      slug,
      name,
      score: scoreMatch[1] === "null" ? null : Number(scoreMatch[1]),
      estimated,
    }
    const existing = records.get(slug)
    if (!existing || (existing.score === null && record.score !== null)) {
      records.set(slug, record)
    }
  }
  return [...records.values()]
}

/**
 * Normalize a model name or ID into a comparison key.
 *
 * Parenthesized qualifiers ("(Max)"), the OpenCode "Free" tier marker
 * ("GLM-5.3-Flash Free", "glm-5.3-flash-free" -> "glm53flash"), and all
 * punctuation are removed so an OpenCode catalog entry finds its Artificial
 * Analysis counterpart.
 */
export function matchKey(nameOrId: string): string {
  return nameOrId
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/\bfree\b/g, "")
    .replace(/[^a-z0-9]/g, "")
    .replace(/free$/, "")
}

/** Prefer the highest-effort variant of a model when AA scores several. */
export function variantPriority(name: string): number {
  const qualifier = (name.match(/\(([^)]*)\)/)?.[1] ?? "").toLowerCase()
  if (/\bmax\b/.test(qualifier)) return 5
  if (/\bxhigh\b/.test(qualifier)) return 4
  if (/\bhigh\b/.test(qualifier)) return 3
  if (/\bmedium\b/.test(qualifier)) return 2
  if (/\blow\b/.test(qualifier)) return 1
  return 3 // plain entries and date qualifiers such as (0902)
}

function variantLabel(name: string): string | undefined {
  const qualifier = name.match(/\(([^)]*)\)/)?.[1]
  return qualifier ? qualifier.toLowerCase() : undefined
}

/**
 * Build a lookup keyed by `matchKey`. When a base name has several effort
 * variants, keep the highest-priority one and note the variant.
 */
export function indexRecords(records: readonly AARecord[]): Record<string, AAScore> {
  const grouped = new Map<string, AARecord[]>()
  for (const record of records) {
    const key = matchKey(record.name) || matchKey(record.slug)
    const list = grouped.get(key) ?? []
    list.push(record)
    grouped.set(key, list)
  }
  const out: Record<string, AAScore> = {}
  for (const [key, list] of grouped) {
    const scored = list.filter((record) => record.score !== null)
    const pool = scored.length > 0 ? scored : list
    pool.sort((a, b) => variantPriority(b.name) - variantPriority(a.name))
    const best = pool[0]
    const label = variantLabel(best.name)
    out[key] = {
      score: best.score,
      name: best.name,
      note: label && label !== "max" ? `AA variant: (${label})` : undefined,
    }
  }
  return out
}

/**
 * Look up the AA entry for an OpenCode model by model ID or display name.
 *
 * Matching is deliberately strict to avoid false positives between sibling
 * models (e.g. "Kimi K3" must never pick up "Kimi K3.1 Pro"'s score). An AA
 * key matches when it equals the model's key, possibly plus a checkpoint
 * suffix ("deepseekv41flash1017" for "DeepSeek V4.1 Flash"). Loose prefix
 * matching is not performed in either direction.
 */
export function lookupScore(
  index: Readonly<Record<string, AAScore>>,
  modelID: string,
  modelName: string,
): AAScore | undefined {
  const keys = [matchKey(modelID), matchKey(modelName)].filter((key) => key.length > 0)
  const exact = keys.map((key) => index[key]).filter(Boolean)
  const suffixed: { suffix: string; entry: AAScore }[] = []
  for (const key of keys) {
    if (key.length < 4) continue
    for (const [candidate, entry] of Object.entries(index)) {
      if (!candidate.startsWith(key)) continue
      const suffix = candidate.slice(key.length)
      if (!/^\d{1,4}$/.test(suffix)) continue
      // A trailing version ("Beam 1.0" -> "beam10" for "beam") is only trusted
      // when the model's own key does not end in digits: "GLM 5" ("glm5") must
      // never pick up "GLM 5.1"'s ("glm51") score.
      if (!/[a-z]$/.test(key) && suffix.length < 3) continue
      suffixed.push({ suffix, entry })
    }
  }
  suffixed.sort((a, b) => a.suffix.length - b.suffix.length)
  // Prefer real scores: exact match first, then a checkpoint/version variant
  // ("DeepSeek V4.1 Flash 1017" scoring "DeepSeek V4.1 Flash"). An unscored
  // exact entry is only returned when nothing carries a score at all.
  return (
    exact.find((entry) => entry!.score != null) ??
    suffixed.find(({ entry }) => entry.score != null)?.entry ??
    exact[0]
  )
}

/**
 * The bundled snapshot was keyed with `matchKey`; re-normalize defensively so
 * entries like "glm53flashfree" merge onto "glm53flash". Non-null scores win
 * when duplicate keys merge.
 */
let normalizedSnapshot: Record<string, AAScore> | undefined
function snapshotIndex(): Record<string, AAScore> {
  if (normalizedSnapshot) return normalizedSnapshot
  const out: Record<string, AAScore> = {}
  for (const [key, entry] of Object.entries(AA_SNAPSHOT)) {
    const normalized = matchKey(key) || key
    const existing = out[normalized]
    if (!existing || (existing.score == null && entry.score != null)) {
      out[normalized] = entry
    }
  }
  normalizedSnapshot = out
  return out
}

/**
 * Use the bundled snapshot to fill gaps the live data does not cover: AA only
 * publishes scores for some models, and some live records carry `null` even
 * though a score exists elsewhere on the site. Live non-null scores always win.
 */
export function withSnapshotFallback(index: Readonly<Record<string, AAScore>>): Record<string, AAScore> {
  const merged: Record<string, AAScore> = { ...index }
  for (const [key, entry] of Object.entries(snapshotIndex())) {
    const live = merged[key]
    if (live && live.score != null) continue
    if (live && entry.score == null) continue
    merged[key] = {
      score: entry.score,
      name: live?.name ?? entry.name,
      note: entry.note ? `${entry.note} [snapshot]` : "[snapshot]",
    }
  }
  return merged
}

/** Fetch scores from the official free Data API (requires an API key). */
async function fetchFromAPI(
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<{ records: AARecord[]; version: string }> {
  const records: AARecord[] = []
  let version = AA_INDEX_VERSION
  for (let page = 1; page <= 5; page++) {
    const response = await fetchImpl(`${AA_API_URL}?page=${page}`, {
      headers: { "x-api-key": apiKey },
    })
    if (!response.ok) throw new Error(`AA API returned ${response.status}`)
    const body = (await response.json()) as {
      intelligence_index_version?: number | string
      data?: unknown[]
    }
    if (body.intelligence_index_version !== undefined) version = String(body.intelligence_index_version)
    const items = body.data ?? []
    if (items.length === 0) break
    for (const raw of items) {
      const item = raw as Record<string, unknown>
      const evaluations = (item.evaluations ?? {}) as Record<string, unknown>
      const rawScore =
        item.artificial_analysis_intelligence_index ??
        evaluations.artificial_analysis_intelligence_index
      records.push({
        slug: String(item.slug ?? ""),
        name: String(item.name ?? item.slug ?? ""),
        score: typeof rawScore === "number" ? rawScore : null,
        estimated: false,
      })
    }
  }
  return { records, version }
}

/** Scrape the embedded dataset from the public model pages (no key needed). */
async function fetchFromPages(fetchImpl: typeof fetch): Promise<AARecord[]> {
  for (const url of [AA_MODELS_URL, "https://artificialanalysis.ai/evaluations/artificial-analysis-intelligence-index"]) {
    try {
      const response = await fetchImpl(url)
      if (!response.ok) continue
      const html = await response.text()
      const records = parseAARecords(decodeRSC(html))
      if (records.length > 0) return records
    } catch {
      // try the next source
    }
  }
  return []
}

/**
 * Fetch current Intelligence Index scores. Falls back to the bundled snapshot
 * when both live sources fail, so `/models` always shows something sensible.
 */
export async function fetchAAScores(options?: {
  apiKey?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}): Promise<AAFetched> {
  const fetchImpl = options?.fetchImpl ?? fetch
  const apiKey = options?.apiKey ?? process.env.ARTIFICIALANALYSIS_API_KEY
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options?.timeoutMs ?? 15_000)
  const guarded: typeof fetch = (input, init) => fetchImpl(input, { ...init, signal: controller.signal })
  try {
    if (apiKey) {
      try {
        const { records, version } = await fetchFromAPI(apiKey, guarded)
        if (records.length > 0) {
          return {
            scores: withSnapshotFallback(indexRecords(records)),
            version,
            source: "artificialanalysis.ai Data API",
            fetchedAt: new Date().toISOString(),
          }
        }
      } catch {
        // fall through to public pages
      }
    }
    const records = await fetchFromPages(guarded)
    if (records.length > 0) {
      return {
        scores: withSnapshotFallback(indexRecords(records)),
        version: AA_INDEX_VERSION,
        source: "artificialanalysis.ai model pages",
        fetchedAt: new Date().toISOString(),
      }
    }
    throw new Error("no Artificial Analysis data could be fetched")
  } finally {
    clearTimeout(timer)
  }
}

/** Snapshot fallback used when live fetching fails. */
export function snapshotScores(): AAFetched {
  return {
    scores: snapshotIndex(),
    version: AA_INDEX_VERSION,
    source: "bundled snapshot (artificialanalysis.ai, 2026-10-31)",
    fetchedAt: new Date().toISOString(),
  }
}
