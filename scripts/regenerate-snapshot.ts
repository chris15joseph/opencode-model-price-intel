#!/usr/bin/env node
/**
 * Regenerate src/aa-snapshot.ts from live Artificial Analysis data.
 *
 * Usage (Node 22.6+; Node 26 runs TypeScript directly):
 *
 *   ARTIFICIALANALYSIS_API_KEY=... node scripts/regenerate-snapshot.ts
 *   node scripts/regenerate-snapshot.ts --from-page
 *
 * The Free API (`/api/v2/language/models/free`) is preferred because it covers
 * the full model list. `--from-page` scrapes the public leaderboard page, which
 * is a superset of the model-list page. Existing snapshot entries are refreshed
 * from the current version; entries the page no longer scores are kept as
 * `null` (with their historical notes) rather than carrying a stale score.
 * Review the generated diff before committing: scores are only comparable
 * within the same index version.
 */

import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { fetchFromAPI, fetchFromPages, indexRecords } from "../src/aa.ts"
import {
  AA_SNAPSHOT,
  AA_SNAPSHOT_ALIASES,
  type AAScore,
} from "../src/aa-snapshot.ts"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const usePage = process.argv.includes("--from-page")
const apiKey = process.env.ARTIFICIALANALYSIS_API_KEY
const log = (message: string) => console.warn(message)

/** Refresh a null entry's caveat without losing historical v4.x context. */
function nullNote(previous: AAScore | undefined, version: string): string {
  const note = previous?.note
    ?.replace(/(not scored in )v\d+(?:\.\d+)*/gi, `$1v${version}`)
    .replace(/\((v)\d+(?:\.\d+)* or earlier\)/gi, `($1${version} or earlier)`)
  if (!note) return `Not scored in v${version}.`
  if (/^AA variant:/i.test(note)) return `Not scored in v${version}. ${note}`
  if (/^v\d+(?:\.\d+)* score\b/i.test(note)) return `Not scored in v${version}.`
  return note
}

if (!usePage && !apiKey) {
  console.error(
    "Set ARTIFICIALANALYSIS_API_KEY, or pass --from-page to regenerate from the public leaderboard page.",
  )
  process.exit(1)
}

let records
let version: string
let partial = false
if (usePage || !apiKey) {
  const page = await fetchFromPages(fetch, { log })
  records = page.records
  version = page.version
  partial = true
  console.warn(
    `[regenerate] page source (${records.length} records, v${version}); existing snapshot entries will be refreshed.`,
  )
} else {
  const api = await fetchFromAPI(apiKey, fetch, { log })
  records = api.records
  version = api.version
}

if (records.length === 0) {
  console.error("[regenerate] no live records; refusing to overwrite the snapshot.")
  process.exit(1)
}

const live = indexRecords(records)
const entries = new Map<string, AAScore>()
if (partial) {
  // The page only embeds scored rows (plus catalog metadata), so keep the
  // curated snapshot as the base and refresh each entry from the current
  // version. A previously scored model that is no longer scored becomes null
  // instead of presenting an older index version's number as current.
  for (const [key, previous] of Object.entries(AA_SNAPSHOT)) {
    let current = live[key]
    if (!current && previous.score !== null) {
      // Alias keys (e.g. deepseekv4pro, nemotron3ultra) may only exist under a
      // longer checkpoint/variant name in live data. Accept a unique scored
      // candidate so the alias keeps the current version's score.
      const candidates = Object.entries(live).filter(
        ([candidate, entry]) =>
          candidate.length > key.length + 2 &&
          candidate.startsWith(key) &&
          entry.score !== null,
      )
      if (candidates.length === 1) current = candidates[0][1]
    }
    if (!current || current.score === null) {
      entries.set(key, {
        score: null,
        name: current?.name ?? previous.name,
        note: nullNote(previous, version),
      })
      continue
    }
    entries.set(key, {
      score: current.score,
      name: current.name,
      ...(current.note ? { note: current.note } : {}),
    })
  }
  // Add every scored entry from the current version that the snapshot did not
  // already cover. Unscored catalog rows are intentionally not added.
  for (const [key, entry] of Object.entries(live)) {
    if (entry.score === null || entries.has(key)) continue
    entries.set(key, { score: entry.score, name: entry.name, ...(entry.note ? { note: entry.note } : {}) })
  }
} else {
  for (const [key, entry] of Object.entries(live)) {
    const previous = AA_SNAPSHOT[key]
    const note =
      previous && previous.name === entry.name && previous.note
        ? previous.note
        : entry.note
    entries.set(key, { score: entry.score, name: entry.name, ...(note ? { note } : {}) })
  }
}

const aliases: Record<string, string> = {}
for (const [alias, target] of Object.entries(AA_SNAPSHOT_ALIASES)) {
  if (entries.has(target)) {
    aliases[alias] = target
  } else {
    console.warn(`[regenerate] dropping alias ${alias}: target ${target} is no longer in the snapshot`)
  }
}

const captured = new Date().toISOString()
const date = captured.slice(0, 10)
const sorted = [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
const scores = sorted.filter(([, entry]) => entry.score !== null).length

const lines: string[] = [
  "/**",
  ` * Bundled snapshot of the Artificial Analysis Intelligence Index (v${version}).`,
  " *",
  " * FALLBACK ONLY. Regenerate with `node scripts/regenerate-snapshot.ts`.",
  ` * Captured ${date}${partial ? " from the public leaderboard page" : " from the Free Data API"}.`,
  " * See SNAPSHOT-NOTICE.md for provenance and attribution.",
  " *",
  " * Canonical keys are `matchKey(name)` values; OpenCode ID-order aliases are",
  " * documented in AA_SNAPSHOT_ALIASES. Do not mix scores across index versions.",
  " */",
  "",
  "export interface AAScore {",
  "  /** Intelligence Index score, or null when not scored in this version. */",
  "  score: number | null",
  "  /** Name of the exact AA entry matched (includes effort variant). */",
  "  name: string",
  "  /** Caveats, e.g. effort variant or historical scores. */",
  "  note?: string",
  "}",
  "",
  `export const AA_SNAPSHOT_VERSION = ${JSON.stringify(version)}`,
  "/** Kept for callers that imported the original constant. */",
  "export const AA_INDEX_VERSION = AA_SNAPSHOT_VERSION",
  `export const AA_SNAPSHOT_DATE = ${JSON.stringify(date)}`,
  '/** Capture timestamp (UTC midnight on the capture date), not \"now\". */',
  "export const AA_SNAPSHOT_CAPTURED_AT = `${AA_SNAPSHOT_DATE}T00:00:00.000Z`",
  "",
  "/** Documented OpenCode-ID aliases -> canonical snapshot key. */",
  "export const AA_SNAPSHOT_ALIASES: Readonly<Record<string, string>> = Object.freeze({",
  ...Object.entries(aliases).map(([alias, target]) => `  ${JSON.stringify(alias)}: ${JSON.stringify(target)},`),
  "})",
  "",
  "export const AA_SNAPSHOT: Readonly<Record<string, AAScore>> = {",
]
for (const [key, entry] of sorted) {
  lines.push(`  ${JSON.stringify(key)}: {`)
  lines.push(`    score: ${entry.score === null ? "null" : entry.score},`)
  lines.push(`    name: ${JSON.stringify(entry.name)},`)
  if (entry.note) lines.push(`    note: ${JSON.stringify(entry.note)},`)
  lines.push("  },")
}
lines.push("}")
lines.push("")
lines.push("// Shared process-wide; freeze so accidental mutation cannot poison lookups.")
lines.push("Object.freeze(AA_SNAPSHOT)")
lines.push("")

writeFileSync(join(root, "src/aa-snapshot.ts"), lines.join("\n"))
console.log(
  `[regenerate] wrote ${sorted.length} entries (${scores} scored, ${sorted.length - scores} AA n/a), version ${version}, captured ${captured}`,
)
