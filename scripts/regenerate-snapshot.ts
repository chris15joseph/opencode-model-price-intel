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
 * the full model list. `--from-page` scrapes only the public model-list page,
 * so it retains existing entries that the page does not list and labels them
 * accordingly. Review the generated diff before committing: scores are only
 * comparable within the same major index version.
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

if (!usePage && !apiKey) {
  console.error(
    "Set ARTIFICIALANALYSIS_API_KEY, or pass --from-page to regenerate from the partial public page.",
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
    `[regenerate] page source is partial (${records.length} records); existing snapshot entries will be retained.`,
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
  for (const [key, entry] of Object.entries(AA_SNAPSHOT)) entries.set(key, entry)
}
for (const [key, entry] of Object.entries(live)) {
  const previous = AA_SNAPSHOT[key]
  const note =
    previous && previous.name === entry.name && previous.note
      ? previous.note
      : entry.note
  entries.set(key, { score: entry.score, name: entry.name, ...(note ? { note } : {}) })
}
if (partial) {
  for (const [key, entry] of entries) {
    if (live[key]) continue
    const note = entry.note
      ? `${entry.note} [retained from previous capture; not on the model page]`
      : "[retained from previous capture; not on the model page]"
    entries.set(key, { ...entry, note })
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
  ` * Captured ${date}${partial ? " from the partial public model-list page" : " from the Free Data API"}.`,
  " * See RELEASE.md for provenance and attribution.",
  " *",
  " * Canonical keys are `matchKey(name)` values; OpenCode ID-order aliases are",
  " * documented in AA_SNAPSHOT_ALIASES. Do not mix scores across major versions.",
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
