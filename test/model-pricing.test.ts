/**
 * Unit tests for pricing formatting and the Artificial Analysis data layer.
 * Live-network calls are never required: fetchers are exercised with fake
 * `fetch` implementations, and parser tests use captured AA records
 * (test/fixtures/aa-payload.txt, aa-company-aggregates.txt).
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

import {
  AA_API_URL,
  AA_MAX_API_PAGES,
  AA_MODELS_URL,
  decodeRSC,
  parseAARecords,
  parsePageVersion,
  normalizeVersion,
  indexRecords,
  lookupScore,
  matchKey,
  variantPriority,
  fetchAAScores,
  fetchFromAPI,
  fetchFromPages,
  snapshotScores,
  withSnapshotFallback,
  type AARecord,
} from "../src/aa.ts"
import {
  AA_SNAPSHOT,
  AA_SNAPSHOT_ALIASES,
  AA_SNAPSHOT_CAPTURED_AT,
  AA_SNAPSHOT_VERSION,
  type AAScore,
} from "../src/aa-snapshot.ts"
import { usd, formatCost, pricingSegment, type CostTier } from "../src/pricing.ts"

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures")
const payload = readFileSync(join(fixtures, "aa-payload.txt"), "utf8")
const companyPayload = readFileSync(join(fixtures, "aa-company-aggregates.txt"), "utf8")

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  })
}

function pageResponse(decoded: string): Response {
  return new Response(`<script>self.__next_f.push([1,${JSON.stringify(decoded)}])</script>`, {
    headers: { "content-type": "text/html" },
  })
}

function fakeFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init)) as typeof fetch
}

function apiBody(data: unknown[], overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tier: "free",
    intelligence_index_version: 5,
    pagination: { page: 1, page_size: 200, total_pages: 1, has_more: false },
    data,
    ...overrides,
  }
}

function modelRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "2f339a97-9a0d-499a-9cb5-e0db665bfa25",
    slug: "page-model",
    name: "Page Model (Max)",
    shortName: "Page Model (max)",
    suffix: "Max",
    releaseDate: "2026-09-03",
    intelligenceIndex: 42.5,
    ...overrides,
  }
}

// ---------------------------------------------------------------- pricing

test("usd preserves published precision and rejects invalid prices", () => {
  assert.equal(usd(10), "$10")
  assert.equal(usd(0.006), "$0.006")
  assert.equal(usd(0.107), "$0.107")
  assert.equal(usd(0.003625), "$0.003625")
  assert.equal(usd(0.00005), "$0.00005")
  assert.equal(usd(0), "$0")
  assert.equal(usd(0.000049), "<$0.00005")
  assert.equal(usd(-1), "?")
  assert.equal(usd(Number.NaN), "?")
  assert.equal(usd(Number.POSITIVE_INFINITY), "?")
  assert.equal(usd(1e21).includes("e"), false)
  assert.equal(usd(1e21), "$1000000000000000000000")
})

const gpt54Tiers: CostTier[] = [
  { input: 2.5, output: 15, cache: { read: 0.25, write: 0 } },
  { tier: { type: "context", size: 272_000 }, input: 5, output: 22.5, cache: { read: 0.5, write: 0 } },
]

test("formatCost labels context tiers from their own lower threshold", () => {
  const tiers = formatCost(gpt54Tiers)
  assert.equal(tiers.length, 2)
  assert.equal(tiers[0].tierLabel, undefined)
  assert.equal(tiers[1].tierLabel, ">272K")
  assert.equal(tiers[0].input, "$2.5")
  assert.equal(tiers[0].cacheRead, "$0.25")
  assert.equal(tiers[1].output, "$22.5")
})

test("formatCost handles 2- and 3+ context overrides", () => {
  const twoOverrides: CostTier[] = [
    { input: 0.15, output: 0.5, cache: { read: 0.03, write: 0 } },
    { tier: { type: "context", size: 32_000 }, input: 0.3, output: 1, cache: { read: 0.06, write: 0 } },
    { tier: { type: "context", size: 256_000 }, input: 0.6, output: 2, cache: { read: 0.12, write: 0 } },
  ]
  assert.deepEqual(
    formatCost(twoOverrides).map((tier) => tier.tierLabel),
    [undefined, ">32K", ">256K"],
  )

  const threeOverrides: CostTier[] = [
    { input: 0.216, output: 0.861, cache: { read: 0.0432, write: 0.27 } },
    { tier: { type: "context", size: 32_000 }, input: 0.359, output: 1.1, cache: { read: 0.07, write: 0.3 } },
    { tier: { type: "context", size: 128_000 }, input: 0.5, output: 1.5, cache: { read: 0.1, write: 0.4 } },
    { tier: { type: "context", size: 256_000 }, input: 0.717, output: 2, cache: { read: 0.14, write: 0.5 } },
  ]
  assert.deepEqual(
    formatCost(threeOverrides).map((tier) => tier.tierLabel),
    [undefined, ">32K", ">128K", ">256K"],
  )
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

test("pricingSegment compact format reads <in>/<out>/<read>/<write>", () => {
  assert.equal(
    pricingSegment([{ input: 0.4, output: 0.5, cache: { read: 0.01, write: 0.05 } }], "compact"),
    "$0.4/$0.5/$0.01/$0.05",
  )
  assert.equal(
    pricingSegment([{ input: 10, output: 50, cache: { read: 1, write: 12.5 } }], "compact"),
    "$10/$50/$1/$12.5",
  )
  assert.equal(pricingSegment([{ input: 0, output: 0, cache: { read: 0, write: 0 } }], "compact"), "free")
  assert.equal(pricingSegment(undefined, "compact"), "n/a")
  assert.equal(pricingSegment(gpt54Tiers, "compact"), "$2.5/$15/$0.25/$0 (2 tiers)")
})

test("free requires input, output and both cache prices to be zero", () => {
  const cacheBilled: CostTier[] = [
    { input: 0, output: 0, cache: { read: 0, write: 12.5 } },
  ]
  const [tier] = formatCost(cacheBilled)
  assert.equal(tier.free, false)
  assert.equal(tier.cacheWrite, "$12.5")
  assert.equal(pricingSegment(cacheBilled), "in $0 out $0 · cache read $0 write $12.5")
})

test("Mistral's paid price is never rendered as free", () => {
  // Console paid price: input $0.68, output $2.09 per 1M tokens.
  const mistral: CostTier[] = [
    { input: 0.68, output: 2.09, cache: { read: 0, write: 0 } },
  ]
  const [tier] = formatCost(mistral)
  assert.equal(tier.free, false)
  assert.equal(tier.input, "$0.68")
  assert.equal(tier.output, "$2.09")
  assert.notEqual(pricingSegment(mistral), "free")
  assert.match(pricingSegment(mistral), /in \$0\.68 out \$2\.09/)
  assert.match(pricingSegment(mistral, "compact"), /^\$0\.68\/\$2\.09\//)
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

test("parseAARecords is JSON-aware: escaped quotes, reordered fields, long records", () => {
  const records = parseAARecords(
    [
      JSON.stringify({
        name: 'Foo "Bar" Pro',
        slug: "quote-model",
        id: "1",
        intelligenceIndex: 12.3,
      }),
      JSON.stringify({
        name: "Reordered Model",
        intelligenceIndex: 44.4,
        slug: "reordered",
        id: "2",
      }),
      JSON.stringify({
        id: "3",
        slug: "long-record",
        name: "Long Record",
        padding: "x".repeat(3_100),
        intelligenceIndex: 33.3,
      }),
      JSON.stringify({
        id: "4",
        slug: "missing-score",
        name: "Missing Score",
      }),
      JSON.stringify({
        id: "5",
        slug: "negative",
        name: "Negative Score",
        intelligenceIndex: -5,
      }),
      JSON.stringify({
        id: "6",
        slug: "exponent",
        name: "Exponent Score",
        intelligenceIndex: 1e-5,
      }),
    ].join("\n"),
  )
  const bySlug = new Map(records.map((r) => [r.slug, r]))
  assert.equal(bySlug.get("quote-model")?.name, 'Foo "Bar" Pro')
  assert.equal(bySlug.get("quote-model")?.score, 12.3)
  assert.equal(bySlug.get("reordered")?.score, 44.4)
  assert.equal(bySlug.get("long-record")?.score, 33.3)
  assert.equal(bySlug.get("missing-score")?.score, null)
  assert.equal(bySlug.get("negative")?.score, null)
  // 1e-5 parses as 0.00001, never the regex-fragmented "1".
  assert.equal(bySlug.get("exponent")?.score, 0.00001)
  for (const record of records) {
    if (record.score !== null) {
      assert.ok(Number.isFinite(record.score) && record.score >= 0, `bad score ${record.score}`)
    }
  }
})

test("parseAARecords never returns NaN/infinity from malformed JSON or a borrowed score", () => {
  const malformed = [
    '{"id":"1","slug":"nan","name":"NaN Model","intelligenceIndex":1.2.3}',
    '{"id":"2","slug":"inf","name":"Infinity Model","intelligenceIndex":Infinity}',
  ].join("\n")
  assert.deepEqual(parseAARecords(malformed), [])

  const records = parseAARecords(
    [
      JSON.stringify({ id: "a", slug: "a", name: "A Model", releaseDate: "2026-01-01" }),
      JSON.stringify({ id: "b", slug: "b", name: "B Model", intelligenceIndex: 9.9 }),
    ].join("\n"),
  )
  const bySlug = new Map(records.map((r) => [r.slug, r]))
  assert.equal(bySlug.get("a")?.score, null) // does not borrow B's score
  assert.equal(bySlug.get("b")?.score, 9.9)
})

test("parseAARecords filters company aggregate rows", () => {
  const records = parseAARecords(companyPayload)
  assert.deepEqual(
    records.map((r) => r.slug),
    ["gpt-6-astra"],
  )
})

test("page version is parsed when present, otherwise assumed 5.0", async () => {
  assert.equal(parsePageVersion('{"intelligenceIndexVersion":5.1}'), "5.1")
  assert.equal(parsePageVersion('{"intelligence_index_version":"v5.0"}'), "5.0")
  assert.equal(parsePageVersion("no version here"), undefined)

  const decoded = `{"intelligenceIndexVersion":5.1}\n${JSON.stringify(modelRecord())}`
  const explicit = await fetchFromPages(fakeFetch(() => pageResponse(decoded)))
  assert.equal(explicit.version, "5.1")
  assert.equal(explicit.versionAssumed, false)
  assert.equal(explicit.records[0].score, 42.5)

  const assumed = await fetchFromPages(fakeFetch(() => pageResponse(JSON.stringify(modelRecord()))))
  assert.equal(assumed.version, "5.0")
  assert.equal(assumed.versionAssumed, true)
})

test("page fallback uses only the model-list page", async () => {
  const urls: string[] = []
  const fetchImpl = fakeFetch((url) => {
    urls.push(url)
    if (url !== AA_MODELS_URL) throw new Error(`unexpected fallback URL: ${url}`)
    return pageResponse(JSON.stringify(modelRecord()))
  })
  const result = await fetchAAScores({ fetchImpl, log: () => {}, retryDelayMs: 0 })
  assert.deepEqual(urls, [AA_MODELS_URL])
  assert.match(result.source, /model pages/)
  assert.match(result.source, /assumed 5\.0/)
  assert.equal(lookupScore(result.scores, "page-model", "Page Model")?.score, 42.5)
})

// ---------------------------------------------------------------- matching

test("variantPriority prefers Max > Xhigh > High > Medium > Low > plain/date", () => {
  assert.ok(variantPriority("Claude Opus 5.5 (Max, Default Fallback)") > variantPriority("Claude Opus 5.5 (Xhigh, Default Fallback)"))
  assert.ok(variantPriority("Grok 4.7 (Xhigh)") > variantPriority("Grok 4.7 (High)"))
  assert.ok(variantPriority("Grok 4.7 (High)") > variantPriority("Grok 4.7 (Medium)"))
  assert.ok(variantPriority("Grok 4.7 (Medium)") > variantPriority("Grok 4.7 (Low)"))
  assert.ok(variantPriority("Grok 4.7 (Low)") > variantPriority("Grok 4.7"))
  assert.equal(variantPriority("Kimi K3.1 Pro"), 1) // plain entry
  assert.equal(variantPriority("Qwen3.8 Max (0902)"), 1) // date qualifier
})

test("indexRecords keeps the best variant deterministically", () => {
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

test("indexRecords has no High/plain tie and does not hide an unscored max effort", () => {
  const highFirst = indexRecords([
    { slug: "tie", name: "Tie Model (High)", score: 20, estimated: false },
    { slug: "tie", name: "Tie Model", score: 10, estimated: false },
  ])
  const plainFirst = indexRecords([
    { slug: "tie", name: "Tie Model", score: 10, estimated: false },
    { slug: "tie", name: "Tie Model (High)", score: 20, estimated: false },
  ])
  assert.equal(highFirst["tiemodel"].score, 20)
  assert.equal(plainFirst["tiemodel"].score, 20)
  assert.match(highFirst["tiemodel"].note ?? "", /high/)

  const maxFirst = indexRecords([
    { slug: "kimi-k3", name: "Kimi K3 (Max)", score: null, estimated: false },
    { slug: "kimi-k3", name: "Kimi K3 (Low)", score: 17.4, estimated: false },
  ])
  const lowFirst = indexRecords([
    { slug: "kimi-k3", name: "Kimi K3 (Low)", score: 17.4, estimated: false },
    { slug: "kimi-k3", name: "Kimi K3 (Max)", score: null, estimated: false },
  ])
  for (const index of [maxFirst, lowFirst]) {
    assert.equal(index["kimik3"].score, null)
    assert.match(index["kimik3"].note ?? "", /not scored/i)
    assert.match(index["kimik3"].note ?? "", /low/)
    assert.match(index["kimik3"].note ?? "", /17\.4/)
  }
})

test("lookupScore matches by model ID, name, and checkpoint suffix — never sibling models", () => {
  const index = {
    gpt6astra: { score: 56.9, name: "GPT-6 Astra (Max)" },
    deepseekv41flash1017: { score: 32.5, name: "DeepSeek V4.1 Flash 1017 (Max)" },
    kimik31pro: { score: 46.0, name: "Kimi K3.1 Pro" },
    glm53: { score: 31.7, name: "GLM-5.3 (Max)" },
  }
  assert.equal(lookupScore(index, "gpt-6-astra", "GPT 6 Astra")?.score, 56.9)
  assert.equal(lookupScore(index, "deepseek-v4.1-flash", "DeepSeek V4.1 Flash")?.score, 32.5)
  const withNullExact = {
    ...index,
    deepseekv41flash: { score: null, name: "DeepSeek V4.1 Flash" },
  }
  assert.equal(lookupScore(withNullExact, "deepseek-v4.1-flash", "DeepSeek V4.1 Flash")?.score, 32.5)
  assert.equal(lookupScore(index, "kimi-k3", "Kimi K3"), undefined)
  assert.equal(lookupScore(index, "glm-5.3-flash", "GLM-5.3-Flash"), undefined)
  assert.equal(lookupScore(index, "glm-5.3", "GLM-5.3")?.score, 31.7)
  assert.equal(lookupScore(index, "qwen3.8-flash", "Qwen3.8 Flash"), undefined)
})

test("lookupScore rejects generic-family and multi-candidate suffix matches", () => {
  const grokSibling = {
    grok47: { score: 34.3, name: "Grok 4.7 (Xhigh)" },
  }
  // A generic family name must not absorb Grok 4.7.
  assert.equal(lookupScore(grokSibling, "grok", "Grok"), undefined)

  const ambiguous = {
    model2024: { score: 1, name: "Model 2024" },
    model2025: { score: 2, name: "Model 2025" },
  }
  assert.equal(lookupScore(ambiguous, "model", "Model"), undefined)

  // Whole major releases still resolve for a family name (Beam -> Beam 1.0).
  assert.equal(
    lookupScore({ beam10: { score: 17.7, name: "Beam 1.0" } }, "beam-free", "Beam Free")?.score,
    17.7,
  )

  // Conflicting ID and display-name exact matches are ambiguous.
  const conflicting = {
    alpha: { score: 1, name: "Alpha" },
    beta: { score: 2, name: "Beta" },
  }
  assert.equal(lookupScore(conflicting, "alpha", "Beta"), undefined)
})

test("matchKey ignores the OpenCode 'Free' tier marker but keeps Carefree intact", () => {
  assert.equal(matchKey("GLM-5.3-Flash Free"), "glm53flash")
  assert.equal(matchKey("glm-5.3-flash-free"), "glm53flash")
  assert.equal(matchKey("GLM-5.3-Flash"), "glm53flash")
  assert.equal(matchKey("Beam Free"), "beam")
  assert.equal(matchKey("DeepSeek V4.1 Flash Free"), "deepseekv41flash")
  assert.equal(matchKey("Freedom Model"), "freedommodel")
  assert.equal(matchKey("Carefree"), "carefree")
  assert.equal(matchKey("Carefree Free"), "carefree")
})

test("free-tier models find their Artificial Analysis entry", () => {
  const index = {
    glm53flash: { score: 27.8, name: "GLM 5.3 Flash" },
    deepseekv41flash: { score: null, name: "DeepSeek V4.1 Flash" },
    deepseekv41flash1017: { score: 32.5, name: "DeepSeek V4.1 Flash 1017 (Max)" },
    beam10: { score: 17.7, name: "Beam 1.0" },
    mimov26flash: { score: 26.7, name: "MiMo-V2.6-Flash" },
    glm51: { score: 40.0, name: "GLM-5.1 (Max)" },
  }
  assert.equal(lookupScore(index, "glm-5.3-flash-free", "GLM-5.3-Flash Free")?.score, 27.8)
  assert.equal(lookupScore(index, "mimo-v2.6-flash-free", "MiMo-V2.6-Flash Free")?.score, 26.7)
  assert.equal(lookupScore(index, "deepseek-v4.1-flash-free", "DeepSeek V4.1 Flash Free")?.score, 32.5)
  assert.equal(lookupScore(index, "beam-free", "Beam Free")?.score, 17.7)
  assert.equal(lookupScore(index, "glm-5", "GLM 5"), undefined)
  assert.equal(lookupScore(index, "glm-5.1", "GLM 5.1")?.score, 40.0)
})

// ---------------------------------------------------------------- snapshot

test("snapshot provenance keeps its capture date, version and frozen copy", () => {
  const snapshot = snapshotScores()
  assert.equal(snapshot.version, AA_SNAPSHOT_VERSION)
  assert.equal(snapshot.fetchedAt, AA_SNAPSHOT_CAPTURED_AT)
  assert.ok(Date.parse(snapshot.fetchedAt) < Date.now() - 24 * 60 * 60 * 1_000)
  assert.match(snapshot.source, /2026-10-31/)
  assert.notEqual(snapshot.scores, snapshotScores().scores)
  assert.ok(Object.isFrozen(snapshot.scores))
  assert.ok(Object.isFrozen(snapshot.scores.glm53))
  assert.throws(() => {
    ;(snapshot.scores as Record<string, AAScore>).glm53 = { score: 0, name: "poisoned" }
  })
  assert.equal(snapshotScores().scores.glm53?.score, 31.653381843882)
  assert.deepEqual(snapshot.coverage, {
    live: 0,
    snapshot: snapshot.coverage?.snapshot,
    total: snapshot.coverage?.total,
  })
  assert.ok((snapshot.coverage?.snapshot ?? 0) > 0)
})

test("snapshot keys are canonical and aliases are documented", () => {
  assert.equal(AA_SNAPSHOT["beamreflectionbeam"], undefined)
  for (const [key, entry] of Object.entries(AA_SNAPSHOT)) {
    assert.equal(key, matchKey(entry.name), `${key} != matchKey(${JSON.stringify(entry.name)})`)
  }
  const aliases = snapshotScores().scores
  for (const [alias, target] of Object.entries(AA_SNAPSHOT_ALIASES)) {
    assert.ok(AA_SNAPSHOT[target], `alias target ${target} missing`)
    assert.ok(aliases[matchKey(alias)], `alias ${alias} not reachable`)
    assert.equal(aliases[matchKey(alias)]?.name, AA_SNAPSHOT[target].name)
  }
  assert.equal(aliases.claudehaiku45?.name, "Claude 4.5 Haiku")
  assert.equal(aliases.claudesonnet45?.name, "Claude 4.5 Sonnet")
  assert.equal(aliases.musewonder10?.name, "Muse Wonder (Max)")
  // ID-order and AA-name-order lookups resolve to the same candidate.
  assert.equal(
    lookupScore(aliases, "claude-haiku-4-5", "Claude 4.5 Haiku")?.name,
    "Claude 4.5 Haiku",
  )
  assert.equal(
    lookupScore(aliases, "claude-sonnet-4-5", "Claude 4.5 Sonnet")?.name,
    "Claude 4.5 Sonnet",
  )
  assert.equal(
    lookupScore(aliases, "muse-wonder-1.0", "Muse Wonder")?.score,
    43.3248225998431,
  )
})

test("snapshot fallback covers the catalog", () => {
  const snapshot = snapshotScores()
  assert.ok(Object.keys(snapshot.scores).length > 50)
  const near = (actual: number | null | undefined, expected: number) =>
    assert.ok(Math.abs((actual ?? NaN) - expected) < 0.1, `${actual} !~= ${expected}`)
  near(lookupScore(snapshot.scores, "gpt-6-astra", "GPT 6 Astra")?.score, 56.9)
  near(lookupScore(snapshot.scores, "claude-opus-5-5", "Claude Opus 5.5")?.score, 58.4)
  near(lookupScore(snapshot.scores, "kimi-k3.1-pro", "Kimi K3.1 Pro")?.score, 46.0)
  assert.equal(lookupScore(snapshot.scores, "kimi-k3", "Kimi K3")?.score, null)
  const flash = lookupScore(snapshot.scores, "glm-5.3-flash", "GLM-5.3-Flash")
  assert.ok(flash?.score != null && Math.abs(flash.score - 27.8) < 0.1)
  assert.notEqual(flash?.score, lookupScore(snapshot.scores, "glm-5.3", "GLM-5.3")?.score)
})

test("withSnapshotFallback fills gaps live data does not cover", () => {
  const merged = withSnapshotFallback({
    glm53: { score: 31.7, name: "GLM-5.3 (Max)" },
    gemini4argon: { score: null, name: "Gemini 4 Argon (High)" },
  })
  assert.equal(merged.glm53.score, 31.7)
  const flash = lookupScore(merged, "glm-5.3-flash", "GLM-5.3-Flash")
  assert.ok(flash?.score != null && Math.abs(flash.score - 27.8) < 0.1)
  assert.match(flash.note ?? "", /snapshot/)
  const argon = lookupScore(merged, "gemini-4-argon", "Gemini 4 Argon")
  assert.ok(argon?.score != null && Math.abs(argon.score - 50.4) < 0.1)
  assert.equal(argon.name, "Gemini 4 Argon (High)")
  assert.match(argon.note ?? "", /snapshot/)
})

test("snapshot scores are merged only within the same major version", () => {
  const live = {
    liveonly: { score: 1, name: "Live Only" },
    glm53: { score: null, name: "GLM-5.3 (Max)" },
  }
  const v6 = withSnapshotFallback(live, "6.0")
  assert.equal(v6.glm53.score, null)
  assert.equal(v6["glm53flash"], undefined)
  assert.equal(v6.liveonly.score, 1)

  const v51 = withSnapshotFallback(live, "5.1")
  assert.ok(v51["glm53flash"].score != null)
  assert.match(v51["glm53flash"].note ?? "", /snapshot/)

  const defaulted = withSnapshotFallback(live)
  assert.ok(defaulted["glm53flash"].score != null)
})

// ------------------------------------------------------------------- API

test("AA API uses the Free endpoint, validates data, and coerces numeric strings", async () => {
  const calls: { url: string; init?: RequestInit }[] = []
  const fetchImpl = fakeFetch((url, init) => {
    calls.push({ url, init })
    if (!url.startsWith(`${AA_API_URL}?page=`)) throw new Error(`wrong endpoint: ${url}`)
    return jsonResponse(
      apiBody([
        null,
        "not-a-model",
        {
          id: "1",
          slug: "test-model",
          name: "Test Model (Max)",
          evaluations: { artificial_analysis_intelligence_index: "55.5" },
        },
        {
          id: "2",
          slug: "bad-model",
          name: "Bad Model",
          evaluations: { artificial_analysis_intelligence_index: "not-a-number" },
        },
        {
          id: "3",
          slug: "negative-model",
          name: "Negative Model",
          evaluations: { artificial_analysis_intelligence_index: -1 },
        },
      ]),
    )
  })

  const result = await fetchAAScores({ apiKey: "free-key", fetchImpl, retryDelayMs: 0, log: () => {} })
  assert.equal(calls.length, 1)
  assert.match(calls[0].url, /\/api\/v2\/language\/models\/free\?page=1$/)
  assert.equal((calls[0].init?.headers as Record<string, string>)["x-api-key"], "free-key")
  assert.equal(result.version, "5.0")
  assert.equal(result.source, "artificialanalysis.ai Data API")
  assert.equal(lookupScore(result.scores, "test-model", "Test Model")?.score, 55.5)
  assert.equal(lookupScore(result.scores, "bad-model", "Bad Model")?.score, null)
  assert.equal(lookupScore(result.scores, "negative-model", "Negative Model")?.score, null)
  assert.equal(result.coverage?.live, 1)
  assert.ok((result.coverage?.snapshot ?? 0) > 0)
  assert.equal(result.coverage?.total, (result.coverage?.live ?? 0) + (result.coverage?.snapshot ?? 0))
})

test("AA API normalizes version numbers and strings to major.minor", () => {
  assert.equal(normalizeVersion(5), "5.0")
  assert.equal(normalizeVersion(5.1), "5.1")
  assert.equal(normalizeVersion("5"), "5.0")
  assert.equal(normalizeVersion("v5"), "5.0")
  assert.equal(normalizeVersion("6.2"), "6.2")
  assert.equal(normalizeVersion(undefined), "5.0")
})

test("AA API honors has_more/total_pages/next and stops when done", async () => {
  const pages: number[] = []
  const fetchImpl = fakeFetch((url) => {
    const page = Number(new URL(url).searchParams.get("page"))
    pages.push(page)
    if (page === 1) {
      return jsonResponse(
        apiBody(
          [{ id: "1", slug: "first", name: "First Model", evaluations: { artificial_analysis_intelligence_index: 1 } }],
          {
            pagination: { page: 1, page_size: 1, total_pages: 2, has_more: true, next: `${AA_API_URL}?page=2` },
          },
        ),
      )
    }
    return jsonResponse(
      apiBody(
        [{ id: "2", slug: "second", name: "Second Model", evaluations: { artificial_analysis_intelligence_index: 2 } }],
        { pagination: { page: 2, page_size: 1, total_pages: 2, has_more: false } },
      ),
    )
  })
  const result = await fetchFromAPI("key", fetchImpl, { retryDelayMs: 0, log: () => {} })
  assert.deepEqual(pages, [1, 2])
  assert.deepEqual(result.records.map((record) => record.slug), ["first", "second"])
})

test("AA API stops after page 1 when has_more is false", async () => {
  let requests = 0
  const fetchImpl = fakeFetch(() => {
    requests++
    return jsonResponse(
      apiBody(
        [{ id: "1", slug: "only", name: "Only Model", evaluations: { artificial_analysis_intelligence_index: 1 } }],
        { pagination: { page: 1, page_size: 1, total_pages: 99, has_more: false } },
      ),
    )
  })
  await fetchFromAPI("key", fetchImpl, { retryDelayMs: 0, log: () => {} })
  assert.equal(requests, 1)
})

test("AA API pagination has a safe page cap", async () => {
  let requests = 0
  const fetchImpl = fakeFetch(() => {
    requests++
    return jsonResponse(
      apiBody([{ id: String(requests), slug: `model-${requests}`, name: `Model ${requests}` }], {
        pagination: { page: requests, page_size: 1, total_pages: 1_000, has_more: true },
      }),
    )
  })
  const result = await fetchFromAPI("key", fetchImpl, { retryDelayMs: 0, log: () => {} })
  assert.equal(requests, AA_MAX_API_PAGES)
  assert.equal(result.pages, AA_MAX_API_PAGES)
})

test("AA API retries 429/Retry-After and 500 a bounded number of times", async () => {
  let calls = 0
  const retryAfter = fakeFetch(() => {
    calls++
    if (calls === 1) {
      return jsonResponse({ error: "rate limited" }, 429, { "retry-after": "0" })
    }
    return jsonResponse(
      apiBody([{ id: "1", slug: "retried", name: "Retried Model", evaluations: { artificial_analysis_intelligence_index: 7 } }]),
    )
  })
  const retried = await fetchFromAPI("key", retryAfter, { retryDelayMs: 0, log: () => {} })
  assert.equal(calls, 2)
  assert.equal(retried.records[0].score, 7)

  calls = 0
  const serverError = fakeFetch(() => {
    calls++
    if (calls === 1) return jsonResponse({ error: "boom" }, 500)
    return jsonResponse(
      apiBody([{ id: "1", slug: "recovered", name: "Recovered Model", evaluations: { artificial_analysis_intelligence_index: 8 } }]),
    )
  })
  const recovered = await fetchFromAPI("key", serverError, { retryDelayMs: 0, log: () => {} })
  assert.equal(calls, 2)
  assert.equal(recovered.records[0].score, 8)

  calls = 0
  const alwaysLimited = fakeFetch(() => {
    calls++
    return jsonResponse({ error: "rate limited" }, 429, { "retry-after": "0" })
  })
  await assert.rejects(
    fetchFromAPI("key", alwaysLimited, { retryDelayMs: 0, log: () => {} }),
    /429/,
  )
  assert.equal(calls, 3)
})

test("a failing API logs clearly and falls back to the page", async () => {
  const logs: string[] = []
  const fetchImpl = fakeFetch((url) => {
    if (url.includes("/api/v2/")) return jsonResponse({ error: "forbidden" }, 403)
    return pageResponse(JSON.stringify(modelRecord()))
  })
  const result = await fetchAAScores({ apiKey: "key", fetchImpl, retryDelayMs: 0, log: (line) => logs.push(line) })
  assert.match(result.source, /model pages/)
  assert.equal(lookupScore(result.scores, "page-model", "Page Model")?.score, 42.5)
  assert.ok(logs.some((line) => /AA API failed/.test(line) && /403/.test(line)))
})

test("a stalled API does not leave the page fallback with an aborted signal", async () => {
  let pageSignalAborted: boolean | undefined
  const fetchImpl = fakeFetch((url, init) => {
    if (url.includes("/api/v2/")) {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            const error = new Error("aborted")
            error.name = "AbortError"
            reject(error)
          },
          { once: true },
        )
      })
    }
    pageSignalAborted = init?.signal?.aborted
    return pageResponse(JSON.stringify(modelRecord()))
  })

  const result = await fetchAAScores({
    apiKey: "key",
    fetchImpl,
    timeoutMs: 25,
    retryDelayMs: 0,
    log: () => {},
  })
  assert.equal(pageSignalAborted, false)
  assert.match(result.source, /model pages/)
  assert.equal(lookupScore(result.scores, "page-model", "Page Model")?.score, 42.5)
})

test("a live v6 result never contains unlabeled v5 snapshot scores", async () => {
  const fetchImpl = fakeFetch(() =>
    jsonResponse({
      tier: "free",
      intelligence_index_version: 6,
      pagination: { page: 1, page_size: 200, total_pages: 1, has_more: false },
      data: [
        {
          id: "1",
          slug: "v6-model",
          name: "V6 Model (Max)",
          evaluations: { artificial_analysis_intelligence_index: 77.7 },
        },
      ],
    }),
  )
  const result = await fetchAAScores({ apiKey: "key", fetchImpl, retryDelayMs: 0, log: () => {} })
  assert.equal(result.version, "6.0")
  assert.equal(result.scores["glm53flash"], undefined)
  assert.equal(result.coverage?.snapshot, 0)
  assert.equal(lookupScore(result.scores, "v6-model", "V6 Model")?.score, 77.7)
})

test("live fetch: current Intelligence Index scores (skipped offline)", async (t) => {
  let result: Awaited<ReturnType<typeof fetchAAScores>> | undefined
  try {
    result = await fetchAAScores({ timeoutMs: 20_000, log: () => {} })
  } catch {
    t.skip("artificialanalysis.ai unreachable")
    return
  }
  assert.ok(Object.keys(result.scores).length > 10)
  const opus = lookupScore(result.scores, "claude-opus-5-5", "Claude Opus 5.5")
  assert.ok(opus?.score != null, "Claude Opus 5.5 should carry an AA score")
  assert.ok(opus.score > 40, `unexpected AA score ${opus.score}`)
  assert.ok(result.coverage !== undefined)
})
