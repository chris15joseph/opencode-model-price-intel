import {
  AA_INDEX_VERSION,
  AA_SNAPSHOT,
  AA_SNAPSHOT_ALIASES,
  AA_SNAPSHOT_CAPTURED_AT,
  AA_SNAPSHOT_DATE,
  AA_SNAPSHOT_VERSION,
  type AAScore,
} from "./aa-snapshot.ts"
import type { AACoverage, AAFetched, AARecord } from "./aa-types.ts"
import { countNumericScores, majorOf, normalizeVersion } from "./aa-util.ts"

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

export function preferRecord(existing: AARecord | undefined, candidate: AARecord): boolean {
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

export function mergeWithSnapshot(
  index: Readonly<Record<string, AAScore>>,
  version: string,
): { scores: Record<string, AAScore>; coverage: AACoverage } {
  const merged: Record<string, AAScore> = { ...index }
  let live = countNumericScores(index)
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
