/**
 * Plugin wiring tests.
 *
 * These drive `src/index.ts` with a fake OpenCode plugin context and never
 * touch the real network. They cover the command envelope regression, storage
 * isolation, cache validation, refresh-interval clamping, background reloads
 * and cleanup/abort behavior.
 */
import { test } from "node:test"
import assert from "node:assert/strict"

import plugin from "../src/index.ts"
import { lookupScore, snapshotScores } from "../src/aa.ts"
import { CACHE_KEY } from "../src/cache.ts"
import { formatCost, type CostTier } from "../src/pricing.ts"

const HOUR = 3_600_000

// ---------------------------------------------------------------- fixtures

const gptCost: CostTier[] = [
  {
    tier: { type: "context", size: 272_000 },
    input: 2.5,
    output: 15,
    cache: { read: 0.25, write: 0 },
  },
  {
    tier: { type: "context", size: 544_000 },
    input: 5,
    output: 22.5,
    cache: { read: 0.5, write: 0 },
  },
]

interface FakeModel {
  id: string
  modelID: string
  providerID: string
  name: string
  cost: CostTier[]
}

interface ApiRecord {
  slug: string
  name: string
  score: number | null
}

interface CommandLike {
  name: string
  description?: string
  execute: (input: { sessionID: string }) => Promise<void>
}

interface TimerCapture {
  intervals: Array<{ fn: () => void; ms: number; id: unknown }>
  cleared: unknown[]
  restore: () => void
}

function defaultModels(): FakeModel[] {
  return [
    {
      id: "gpt-6-astra",
      modelID: "gpt-6-astra",
      providerID: "opencode",
      name: "GPT 6 Astra · Turbo",
      cost: gptCost,
    },
    {
      id: "kimi-k3",
      modelID: "kimi-k3",
      providerID: "opencode-go",
      name: "Kimi K3",
      cost: [{ input: 3, output: 15, cache: { read: 0.3, write: 3 } }],
    },
  ]
}

function offlineFetch(): typeof fetch {
  return (async () => {
    throw new Error("offline (test)")
  }) as typeof fetch
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

/** A successful AA Data API stand-in; page 2+ is empty. */
function apiFetch(
  records: () => ApiRecord[],
  onCall?: () => void,
): typeof fetch {
  return (async (input: string | URL | Request) => {
    onCall?.()
    const url = new URL(String(input))
    if (url.searchParams.get("page") !== "1") {
      return jsonResponse({ data: [] })
    }
    return jsonResponse({
      intelligence_index_version: 6,
      data: records().map((record) => ({
        slug: record.slug,
        name: record.name,
        artificial_analysis_intelligence_index: record.score,
      })),
    })
  }) as typeof fetch
}

function captureTimers(): TimerCapture {
  const realSetInterval = globalThis.setInterval
  const realClearInterval = globalThis.clearInterval
  const intervals: TimerCapture["intervals"] = []
  const cleared: unknown[] = []

  globalThis.setInterval = ((fn: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    const id = { fakeTimer: true, unref() {} }
    intervals.push({ fn: () => fn(...args), ms: Number(ms ?? 0), id })
    return id
  }) as unknown as typeof setInterval
  globalThis.clearInterval = ((id: unknown) => {
    cleared.push(id)
  }) as unknown as typeof clearInterval

  return {
    intervals,
    cleared,
    restore() {
      globalThis.setInterval = realSetInterval
      globalThis.clearInterval = realClearInterval
    },
  }
}

function captureLogs() {
  const logs = { warn: [] as string[], error: [] as string[], log: [] as string[] }
  const realWarn = console.warn
  const realError = console.error
  const realLog = console.log
  const format = (args: unknown[]) =>
    args
      .map((value) =>
        value instanceof Error ? `${value.name}: ${value.message}` : String(value),
      )
      .join(" ")
  console.warn = (...args: unknown[]) => logs.warn.push(format(args))
  console.error = (...args: unknown[]) => logs.error.push(format(args))
  console.log = (...args: unknown[]) => logs.log.push(format(args))
  return {
    logs,
    restore() {
      console.warn = realWarn
      console.error = realError
      console.log = realLog
    },
  }
}

interface Harness {
  ctx: Record<string, unknown>
  models: FakeModel[]
  commands: Map<string, CommandLike>
  storage: {
    gets: number
    sets: number
    setKeys: string[]
    setValues: unknown[]
  }
  reloads: number
  synthetic: string[]
  logs: { warn: string[]; error: string[]; log: string[] }
  timers: TimerCapture
  modelTransformCount: () => number
  applyModelTransform: () => void
  invokeCommand: (name: string) => Promise<string>
  cleanup: () => Promise<void> | void
}

interface PluginConfig {
  options?: Record<string, unknown>
  models?: FakeModel[]
  cacheValue?: unknown
  cacheGetThrows?: Error
  cacheSetThrows?: Error
  fetch?: typeof fetch
}

function editorFor(models: FakeModel[]) {
  return {
    list: () => models,
    get: (providerID: string, modelID: string) =>
      models.find((model) => model.providerID === providerID && model.modelID === modelID),
    update: (
      providerID: string,
      modelID: string,
      update: (model: FakeModel) => void,
    ) => {
      const model = models.find(
        (candidate) =>
          candidate.providerID === providerID && candidate.modelID === modelID,
      )
      if (model) update(model)
    },
    remove: () => {},
    default: { get: () => undefined, set: () => {} },
    provider: { list: () => [], get: () => undefined },
  }
}

async function createHarness(
  config: PluginConfig,
  timers: TimerCapture,
  logs: Harness["logs"],
): Promise<Harness> {
  const models = (config.models ?? defaultModels()).map((model) => ({
    ...model,
    cost: model.cost.map((tier) => ({ ...tier, cache: { ...tier.cache } })),
  }))
  const commands = new Map<string, CommandLike>()
  const storage = { gets: 0, sets: 0, setKeys: [] as string[], setValues: [] as unknown[] }
  const synthetic: string[] = []
  let modelTransform: ((editor: ReturnType<typeof editorFor>) => void) | undefined
  let modelTransformCount = 0
  let reloads = 0

  const ctx = {
    options: config.options ?? {},
    storage: {
      async get(key: string) {
        storage.gets++
        void key
        if (config.cacheGetThrows) throw config.cacheGetThrows
        return config.cacheValue
      },
      async set(key: string, value: unknown) {
        storage.sets++
        storage.setKeys.push(key)
        storage.setValues.push(value)
        if (config.cacheSetThrows) throw config.cacheSetThrows
      },
    },
    model: {
      async transform(callback: (editor: ReturnType<typeof editorFor>) => void) {
        modelTransform = callback
        modelTransformCount++
        return { dispose: async () => {} }
      },
      async list() {
        return { location: { directory: "/tmp/wiring-test" }, data: models }
      },
      async reload() {
        reloads++
      },
    },
    command: {
      async transform(callback: (editor: { add: (definition: CommandLike) => void }) => void) {
        callback({
          add(definition: CommandLike) {
            commands.set(definition.name, definition)
          },
        })
        return { dispose: async () => {} }
      },
    },
    session: {
      async synthetic(input: { sessionID: string; text: string }) {
        void input.sessionID
        synthetic.push(input.text)
      },
    },
  }

  const cleanup = (await plugin.setup(ctx as never)) ?? (() => {})

  return {
    ctx,
    models,
    commands,
    storage,
    get reloads() {
      return reloads
    },
    synthetic,
    logs,
    timers,
    modelTransformCount: () => modelTransformCount,
    applyModelTransform() {
      assert.ok(modelTransform, "model transform was not registered")
      modelTransform(editorFor(models))
    },
    async invokeCommand(name: string) {
      const command = commands.get(name)
      assert.ok(command, `command ${name} was not registered`)
      await command.execute({ sessionID: "ses_wiring_test" })
      const text = synthetic.at(-1)
      assert.equal(typeof text, "string")
      return text as string
    },
    cleanup,
  }
}

async function withPlugin(
  config: PluginConfig,
  run: (harness: Harness) => Promise<void>,
): Promise<void> {
  const timers = captureTimers()
  const captured = captureLogs()
  const realFetch = globalThis.fetch
  globalThis.fetch = config.fetch ?? offlineFetch()
  let harness: Harness | undefined
  try {
    harness = await createHarness(config, timers, captured.logs)
    await run(harness)
  } finally {
    if (harness) await harness.cleanup()
    globalThis.fetch = realFetch
    captured.restore()
    timers.restore()
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(
  condition: () => boolean,
  description: string,
  timeoutMs = 3_000,
): Promise<void> {
  const started = Date.now()
  while (!condition()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`timed out waiting for ${description}`)
    }
    await delay(5)
  }
}

function unescapedPipes(line: string): number {
  return (line.match(/(?<!\\)\|/g) ?? []).length
}

/** The AA cell the plugin should render for a model from a given index. */
function aaCell(index: ReturnType<typeof snapshotScores>["scores"], id: string, name: string): string {
  const score = lookupScore(index, id, name)
  return score?.score != null ? String(Math.round(score.score * 10) / 10) : "n/a"
}

// ------------------------------------------------------------------- tests

test("both commands use the model-list envelope and emit a valid Markdown table", async () => {
  await withPlugin({}, async (harness) => {
    harness.applyModelTransform()

    const snapshot = snapshotScores()
    const gptAa = aaCell(snapshot.scores, "gpt-6-astra", "GPT 6 Astra · Turbo")
    const kimiAa = aaCell(snapshot.scores, "kimi-k3", "Kimi K3")
    const expectedLabels = formatCost(gptCost).map((tier) => tier.tierLabel ?? "base")
    for (const name of ["model-pricing", "prices"]) {
      const text = await harness.invokeCommand(name)
      const lines = text.split("\n")

      assert.match(lines[0], /^### Model pricing & Artificial Analysis Intelligence Index$/)
      assert.ok(
        lines.includes(
          "| Model | Provider | Tier | Input | Output | Cache read | Cache write | AA Intelligence |",
        ),
      )
      assert.ok(lines.includes("| --- | --- | --- | --- | --- | --- | --- | --- |"))
      // The raw name legitimately contains " · " and must not be truncated.
      assert.match(text, /\| GPT 6 Astra · Turbo \| opencode \|/)
      assert.match(text, /\| Kimi K3 \| opencode-go \|/)
      for (const label of expectedLabels) {
        assert.ok(text.includes(`| ${label} |`), `missing tier label ${label}`)
      }
      assert.ok(text.includes(`| ${gptAa} |`))
      assert.ok(text.includes(`| ${kimiAa} |`))
      assert.ok(text.includes(`Artificial Analysis Intelligence Index v${snapshot.version}`))
      assert.ok(text.includes(`source ${snapshot.source}`))
      assert.match(text, /fetched \d{4}-\d{2}-\d{2}/)
      assert.match(text, /Attribution: https:\/\/artificialanalysis\.ai\//)

      const rows = lines.filter((line) => line.startsWith("| "))
      for (const row of rows) {
        assert.equal(unescapedPipes(row), 9, `malformed table row: ${row}`)
      }
    }
  })
})

test("running the model transform twice does not duplicate the suffix", async () => {
  await withPlugin({}, async (harness) => {
    harness.applyModelTransform()
    const first = harness.models.map((model) => model.name)
    harness.applyModelTransform()
    const second = harness.models.map((model) => model.name)

    assert.deepEqual(second, first)
    for (const name of second) {
      assert.equal(name.split(" · AA ").length - 1, 1, `duplicated suffix: ${name}`)
    }
    assert.match(first[0], /^GPT 6 Astra · Turbo · /)

    const text = await harness.invokeCommand("prices")
    // The table uses the stored base name, not the decorated name.
    assert.match(text, /\| GPT 6 Astra · Turbo \| opencode \|/)
    assert.doesNotMatch(text, /\| GPT 6 Astra · Turbo · [^|]*· AA /)
  })
})

test("storage.get throwing still registers the transform and decorates from the snapshot", async () => {
  const snapshot = snapshotScores()
  const expected = aaCell(snapshot.scores, "gpt-6-astra", "GPT 6 Astra · Turbo")
  await withPlugin({ cacheGetThrows: new Error("storage unavailable") }, async (harness) => {
    assert.equal(harness.modelTransformCount(), 1)
    assert.ok(harness.commands.has("model-pricing"))
    assert.ok(harness.commands.has("prices"))

    harness.applyModelTransform()
    assert.ok(harness.models[0].name.endsWith(`AA ${expected}`))
    await harness.invokeCommand("prices")
  })
})

test("storage.set throwing keeps live data and does not log a fetch failure", async () => {
  const records = (): ApiRecord[] => [
    { slug: "zeta-live-9000", name: "Zeta Live 9000", score: 99.9 },
  ]
  await withPlugin(
    {
      options: { aaApiKey: "test-key" },
      fetch: apiFetch(records),
      cacheSetThrows: new Error("disk full"),
    },
    async (harness) => {
      await waitFor(() => harness.storage.sets >= 1, "cache write attempt")
      await waitFor(() => harness.reloads >= 1, "live data adoption")
      assert.equal(harness.storage.setKeys[0], CACHE_KEY)
      assert.deepEqual(Object.keys(harness.storage.setValues[0] as object), [
        "scores",
        "version",
        "source",
        "fetchedAt",
      ])

      harness.models.push({
        id: "zeta-live-9000",
        modelID: "zeta-live-9000",
        providerID: "test",
        name: "Zeta Live 9000",
        cost: [],
      })
      harness.applyModelTransform()
      const zeta = harness.models.find((model) => model.id === "zeta-live-9000")
      assert.match(zeta?.name ?? "", /AA 99\.9/)

      assert.ok(
        harness.logs.warn.some((line) => /cache write failed/.test(line)),
        "expected a cache-write warning",
      )
      assert.ok(
        !harness.logs.error.some((line) => /fetch failed/.test(line)),
        "cache write failure must not be reported as a fetch failure",
      )
    },
  )
})

test("corrupt, future-dated and stale caches fall back to the snapshot without throwing", async () => {
  const corrupt = [
    null,
    {},
    { fetchedAt: new Date().toISOString() },
    { scores: null, version: "6.0", source: "x", fetchedAt: new Date().toISOString() },
    {
      scores: { gpt6astra: { score: "NaN", name: "bad" } },
      version: "6.0",
      source: "x",
      fetchedAt: new Date().toISOString(),
    },
    {
      scores: { gpt6astra: { score: 99, name: "future" } },
      version: "6.0",
      source: "x",
      fetchedAt: new Date(Date.now() + 86_400_000).toISOString(),
    },
    {
      scores: { gpt6astra: { score: 99, name: "stale" } },
      version: "6.0",
      source: "x",
      fetchedAt: new Date(Date.now() - 40 * 86_400_000).toISOString(),
    },
  ]

  for (const cacheValue of corrupt) {
    const snapshot = snapshotScores()
    const expected = aaCell(snapshot.scores, "gpt-6-astra", "GPT 6 Astra · Turbo")
    await withPlugin({ cacheValue }, async (harness) => {
      assert.equal(harness.modelTransformCount(), 1)
      harness.applyModelTransform()
      // None of the bad caches may replace the bundled snapshot score.
      assert.ok(harness.models[0].name.endsWith(`AA ${expected}`))
      await harness.invokeCommand("prices")
    })
  }
})

test("refreshHours is validated and clamped to a safe interval", async () => {
  const cases: Array<{ value: unknown; expected: number }> = [
    { value: 720, expected: 596 * HOUR },
    { value: 1000, expected: 596 * HOUR },
    { value: 596, expected: 596 * HOUR },
    { value: 12, expected: 12 * HOUR },
    { value: 0.5, expected: 1 * HOUR },
    { value: 0, expected: 12 * HOUR },
    { value: -5, expected: 12 * HOUR },
    { value: Number.NaN, expected: 12 * HOUR },
    { value: Number.POSITIVE_INFINITY, expected: 12 * HOUR },
    { value: "abc", expected: 12 * HOUR },
    { value: undefined, expected: 12 * HOUR },
  ]

  for (const { value, expected } of cases) {
    const options = value === undefined ? {} : { refreshHours: value }
    await withPlugin({ options }, async (harness) => {
      assert.equal(harness.timers.intervals.length, 1, `expected exactly one timer for ${String(value)}`)
      const delayMs = harness.timers.intervals[0].ms
      assert.ok(Number.isFinite(delayMs), `non-finite timer for ${String(value)}`)
      assert.ok(delayMs >= HOUR, `timer below the 1 h minimum for ${String(value)}`)
      assert.ok(delayMs <= 2_147_483_647, `timer overflow for ${String(value)}`)
      assert.notEqual(delayMs, 1)
      assert.equal(delayMs, expected)
    })
  }
})

test("invalid options are logged once with safe fallbacks", async () => {
  await withPlugin(
    {
      options: {
        decorateNames: "yes",
        costFormat: "fancy",
        aaApiKey: 42,
        refreshHours: "abc",
      },
    },
    async (harness) => {
      assert.equal(harness.modelTransformCount(), 1) // decorateNames falls back to true
      assert.ok(harness.commands.has("model-pricing"))
      assert.ok(harness.commands.has("prices"))
      assert.equal(harness.timers.intervals[0].ms, 12 * HOUR)

      const optionWarnings = harness.logs.warn.filter((line) => line.includes("invalid options"))
      assert.equal(optionWarnings.length, 1)
      for (const option of ["decorateNames", "costFormat", "aaApiKey", "refreshHours"]) {
        assert.match(optionWarnings[0], new RegExp(option))
      }
    },
  )
})

test("background refresh reloads only when the score data changed", async () => {
  let records: ApiRecord[] = [{ slug: "solo-model", name: "Solo Model", score: 10 }]
  await withPlugin(
    { options: { aaApiKey: "test-key" }, fetch: apiFetch(() => records) },
    async (harness) => {
      await waitFor(() => harness.storage.sets >= 1, "initial cache write")
      await waitFor(() => harness.reloads >= 1, "initial reload")
      assert.equal(harness.reloads, 1)

      const tick = harness.timers.intervals[0].fn
      tick()
      await waitFor(() => harness.storage.sets >= 2, "second cache write")
      await delay(25)
      assert.equal(harness.reloads, 1, "identical scores must not reload the registry")

      records = [{ slug: "solo-model", name: "Solo Model", score: 11 }]
      tick()
      await waitFor(() => harness.storage.sets >= 3, "third cache write")
      await waitFor(() => harness.reloads >= 2, "changed scores reload the registry")
      assert.equal(harness.reloads, 2)
    },
  )
})

test("in-flight guard prevents overlapping refreshes", async () => {
  let calls = 0
  let release: ((response: Response) => void) | undefined
  const pendingFetch: typeof fetch = ((input: string | URL | Request, init?: RequestInit) => {
    calls++
    if (calls > 1) return Promise.resolve(jsonResponse({ data: [] }))
    void input
    return new Promise<Response>((resolve, reject) => {
      release = resolve
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      )
    })
  }) as typeof fetch

  await withPlugin(
    { options: { aaApiKey: "test-key" }, fetch: pendingFetch },
    async (harness) => {
      await waitFor(() => calls >= 1, "initial fetch")
      const tick = harness.timers.intervals[0].fn
      tick()
      tick()
      tick()
      await delay(25)
      assert.equal(calls, 1, "a slow fetch must not overlap the next tick")

      assert.ok(release)
      release(
        jsonResponse({
          intelligence_index_version: 6,
          data: [
            {
              slug: "solo-model",
              name: "Solo Model",
              artificial_analysis_intelligence_index: 10,
            },
          ],
        }),
      )
      await waitFor(() => harness.storage.sets >= 1, "completed background fetch")
    },
  )
})

test("cleanup clears the refresh timer and aborts in-flight work", async () => {
  let capturedSignal: AbortSignal | undefined
  const hangingFetch: typeof fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    capturedSignal = init?.signal ?? undefined
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal
      if (!signal) return
      if (signal.aborted) {
        reject(new DOMException("Aborted", "AbortError"))
        return
      }
      signal.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      )
    })
  }) as typeof fetch

  await withPlugin(
    { options: { aaApiKey: "test-key" }, fetch: hangingFetch },
    async (harness) => {
      await waitFor(() => capturedSignal !== undefined, "in-flight fetch")
      const timerId = harness.timers.intervals[0].id
      await harness.cleanup()

      assert.ok(harness.timers.cleared.includes(timerId), "cleanup must clear the timer")
      assert.equal(capturedSignal?.aborted, true, "cleanup must abort the in-flight fetch")
      await delay(20)
      assert.equal(harness.reloads, 0)
    },
  )
})

test("decorateNames:false still registers both commands and keeps names untouched", async () => {
  const cacheValue = {
    scores: { gpt6astra: { score: 42, name: "GPT 6 Astra" } },
    version: "6.0",
    source: "test cache",
    fetchedAt: new Date().toISOString(),
  }

  await withPlugin(
    { options: { decorateNames: false }, cacheValue },
    async (harness) => {
      assert.equal(harness.modelTransformCount(), 0)
      assert.ok(harness.commands.has("model-pricing"))
      assert.ok(harness.commands.has("prices"))

      await waitFor(() => harness.storage.gets >= 1, "cache hydration")
      await delay(25)
      assert.equal(harness.reloads, 0, "no model transform means no registry reload")

      const namesBefore = harness.models.map((model) => model.name)
      const text = await harness.invokeCommand("prices")
      assert.deepEqual(harness.models.map((model) => model.name), namesBefore)
      assert.ok(!harness.models[0].name.includes("AA 42"))
      assert.match(text, /\| GPT 6 Astra · Turbo \| opencode \|/)
      assert.match(text, /\| 42 \|/)
    },
  )
})

test("Markdown cells escape pipes, backslashes and newlines", async () => {
  const cacheValue = {
    scores: {
      gpt6astra: { score: 12.3, name: "GPT 6 Astra", note: "a|b\\c\nd" },
    },
    version: "6.0",
    source: "live|test\\src",
    fetchedAt: new Date().toISOString(),
  }

  await withPlugin({ cacheValue }, async (harness) => {
    await waitFor(() => harness.reloads >= 1, "cache adoption")
    harness.models[0].name = "A|B Model\\X\nY"
    harness.models[0].providerID = "p|v"
    harness.applyModelTransform()
    // The decorated registry name preserves the raw value; escaping happens
    // when it is rendered into a Markdown cell.
    assert.ok(harness.models[0].name.includes("Y · "))
    assert.ok(harness.models[0].name.includes("AA 12.3"))

    const text = await harness.invokeCommand("model-pricing")
    const row = text.split("\n").find((line) => line.includes("A\\|B Model"))
    assert.ok(row, "escaped model row missing")
    assert.ok(row.includes("| A\\|B Model\\\\X Y | p\\|v |"))
    assert.ok(row.includes("12.3 (a\\|b\\\\c d)"))
    assert.equal(unescapedPipes(row), 9)
    assert.ok(text.includes("source live\\|test\\\\src"))
  })
})
