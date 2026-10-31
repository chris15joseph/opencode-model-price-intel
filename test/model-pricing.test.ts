/**
 * Unit tests for pricing formatting and the live Artificial Analysis parser.
 * Parser tests run against real records captured from
 * https://artificialanalysis.ai/models (test/fixtures/aa-payload.txt).
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

import {
  decodeRSC,
  parseAARecords,
  indexRecords,
  lookupScore,
  matchKey,
  variantPriority,
  fetchAAScores,
  snapshotScores,
  withSnapshotFallback,
  type AARecord,
} from "../src/aa.ts"
import { usd, formatCost, pricingSegment, type CostTier } from "../src/pricing.ts"

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures")
const payload = readFileSync(join(fixtures, "aa-payload.txt"), "utf8")

// ---------------------------------------------------------------- pricing

test("usd formats per-1M-token prices compactly", () => {
  assert.equal(usd(10), "$10")
  assert.equal(usd(0.006), "$0.006")
  assert.equal(usd(0.107), "$0.107")
  assert.equal(usd(0), "$0")
})

const gpt54Tiers: CostTier[] = [
  { tier: { type: "context", size: 272_000 }, input: 2.5, output: 15, cache: { read: 0.25, write: 0 } },
  { tier: { type: "context", size: 544_000 }, input: 5, output: 22.5, cache: { read: 0.5, write: 0 } },
]

test("formatCost labels context tiers and cache prices", () => {
  const tiers = formatCost(gpt54Tiers)
  assert.equal(tiers.length, 2)
  assert.equal(tiers[0].tierLabel, "≤272K")
  assert.equal(tiers[1].tierLabel, ">272K")
  assert.equal(tiers[0].input, "$2.5")
  assert.equal(tiers[0].cacheRead, "$0.25")
  assert.equal(tiers[1].output, "$22.5")
})

test("pricingSegment renders the /models line", () => {
  assert.equal(
    pricingSegment([{ input: 10, output: 50, cache: { read: 1, write: 12.5 } }]),
    "in $10 out $50 · cache read $1 write $12.5",
  )
  assert.equal(
    pricingSegment([{ input: 0, output: 0, cache: { read: 0, write: 0 } }]),
    "free",
  )
  const multi = pricingSegment(gpt54Tiers)
  assert.ok(multi.includes("in $2.5 out $15"))
  assert.ok(multi.includes("(2 tiers)"))
  assert.equal(pricingSegment(undefined), "pricing n/a")
})

// ------------------------------------------------------------ AA parsing

test("decodeRSC decodes self.__next_f.push payloads", () => {
  const html = `x<script>self.__next_f.push([1,"{\\"slug\\":\\"gpt-6-astra\\",\\"n\\":1}"])</script>
y<script>self.__next_f.push([1,"plain \\\\n text"])</script>`
  const decoded = decodeRSC(html)
  assert.ok(decoded.includes('{"slug":"gpt-6-astra","n":1}'))
  assert.ok(decoded.includes("plain \\n text"))
})

test("parseAARecords extracts real Artificial Analysis records", () => {
  const records = parseAARecords(payload)
  assert.ok(records.length >= 5, `expected >= 5 records, got ${records.length}`)
  const byName = new Map(records.map((r) => [matchKey(r.name), r]))
  assert.ok(Math.abs((byName.get("gpt6astra")?.score ?? 0) - 56.8538559596797) < 1e-6)
  assert.ok(Math.abs((byName.get("kimik31pro")?.score ?? 0) - 46.0026236744189) < 1e-6)
  assert.ok(Math.abs((byName.get("step5preview")?.score ?? 0) - 28.5283090216016) < 1e-6)
})

test("variantPriority prefers the highest effort variant", () => {
  assert.ok(variantPriority("Claude Opus 5.5 (Max, Default Fallback)") > variantPriority("Claude Opus 5.5 (Xhigh, Default Fallback)"))
  assert.ok(variantPriority("Grok 4.7 (Xhigh)") > variantPriority("Grok 4.7 (Low)"))
  assert.equal(variantPriority("Kimi K3.1 Pro"), 3) // plain entry
})

test("indexRecords keeps the best variant per model", () => {
  const records: AARecord[] = [
    { slug: "claude-opus-5-5", name: "Claude Opus 5.5 (Xhigh, Default Fallback)", score: 57.1, estimated: false },
    { slug: "claude-opus-5-5", name: "Claude Opus 5.5 (Max, Default Fallback)", score: 58.4, estimated: false },
    { slug: "kimi-k3", name: "Kimi K3 (Low)", score: 17.4, estimated: false },
    { slug: "unscored", name: "Unscored Model (Max)", score: null, estimated: false },
  ]
  const index = indexRecords(records)
  assert.equal(index["claudeopus55"].score, 58.4)
  assert.equal(index["kimik3"].score, 17.4)
  assert.match(index["kimik3"].note ?? "", /low/)
  assert.equal(index["unscoredmodel"].score, null)
})

test("lookupScore matches by model ID, name, and checkpoint suffix — never sibling models", () => {
  const index = {
    gpt6astra: { score: 56.9, name: "GPT-6 Astra (Max)" },
    deepseekv41flash1017: { score: 32.5, name: "DeepSeek V4.1 Flash 1017 (Max)" },
    kimik31pro: { score: 46.0, name: "Kimi K3.1 Pro" },
    glm53: { score: 31.7, name: "GLM-5.3 (Max)" },
  }
  // exact, by model ID or display name
  assert.equal(lookupScore(index, "gpt-6-astra", "GPT 6 Astra")?.score, 56.9)
  // checkpoint suffix is fine
  assert.equal(lookupScore(index, "deepseek-v4.1-flash", "DeepSeek V4.1 Flash")?.score, 32.5)
  // siblings must NOT borrow each other's scores
  assert.equal(lookupScore(index, "kimi-k3", "Kimi K3"), undefined)
  assert.equal(lookupScore(index, "glm-5.3-flash", "GLM-5.3-Flash"), undefined)
  assert.equal(lookupScore(index, "glm-5.3", "GLM-5.3")?.score, 31.7)
  // no loose matching for untracked models
  assert.equal(lookupScore(index, "qwen3.8-flash", "Qwen3.8 Flash"), undefined)
})

test("snapshot fallback covers the catalog", () => {
  const snapshot = snapshotScores()
  assert.ok(Object.keys(snapshot.scores).length > 50)
  const near = (actual: number | null | undefined, expected: number) =>
    assert.ok(Math.abs((actual ?? NaN) - expected) < 0.1, `${actual} !~= ${expected}`)
  near(lookupScore(snapshot.scores, "gpt-6-astra", "GPT 6 Astra")?.score, 56.9)
  near(lookupScore(snapshot.scores, "claude-opus-5-5", "Claude Opus 5.5")?.score, 58.4)
  near(lookupScore(snapshot.scores, "kimi-k3.1-pro", "Kimi K3.1 Pro")?.score, 46.0)
  // sibling models must not borrow scores in the snapshot either
  assert.equal(lookupScore(snapshot.scores, "kimi-k3", "Kimi K3")?.score, null)
  const flash = lookupScore(snapshot.scores, "glm-5.3-flash", "GLM-5.3-Flash")
  assert.ok(flash?.score != null && Math.abs(flash.score - 27.8) < 0.1) // its own score
  assert.notEqual(flash?.score, lookupScore(snapshot.scores, "glm-5.3", "GLM-5.3")?.score)
})

test("withSnapshotFallback fills gaps live data does not cover", () => {
  const merged = withSnapshotFallback({
    glm53: { score: 31.7, name: "GLM-5.3 (Max)" },
  })
  // live entry wins
  assert.equal(merged.glm53.score, 31.7)
  // snapshot fills gaps, marked as such
  const argon = lookupScore(merged, "gemini-4-argon", "Gemini 4 Argon")
  assert.ok(argon?.score != null && Math.abs(argon.score - 50.4) < 0.1)
  assert.match(argon.note ?? "", /snapshot/)
})

test("live fetch: current Intelligence Index scores (skipped offline)", async (t) => {
  let result: Awaited<ReturnType<typeof fetchAAScores>> | undefined
  try {
    result = await fetchAAScores({ timeoutMs: 20_000 })
  } catch {
    t.skip("artificialanalysis.ai unreachable")
    return
  }
  assert.ok(Object.keys(result.scores).length > 10)
  const opus = lookupScore(result.scores, "claude-opus-5-5", "Claude Opus 5.5")
  assert.ok(opus?.score != null, "Claude Opus 5.5 should carry an AA score")
  assert.ok(opus.score > 40, `unexpected AA score ${opus.score}`)
})
