/**
 * opencode-model-pricing
 *
 * Makes the `/models` list show each model's input, output and cache prices
 * together with its Artificial Analysis Intelligence Index score.
 *
 * Prices come from the live model registry (`Model.Info.cost`). Intelligence
 * scores are fetched from artificialanalysis.ai and cached in plugin storage,
 * with a periodic refresh while the session is open. Attribution:
 * https://artificialanalysis.ai/
 *
 * The model transform is registered with the bundled snapshot *before* any
 * storage or network work. That makes the first `/models` render immediate;
 * cached or live scores are then adopted in the background and the registry is
 * reloaded only when the score data actually changed.
 *
 * Because the built-in `/models` picker renders `Model.Info.name` as the row
 * title, the pricing/score line is attached to the display name so `/models`
 * lists it per model. `/model-pricing` (alias `/prices`) prints the complete
 * table — every price tier, cache read/write, and the AA score — into the
 * session.
 *
 * Note: an experimental scrolling (marquee) mode for narrow screens existed
 * here and was removed — periodic name repaints made client lists reset their
 * scroll position (both the TUI and the web UI). Names are therefore static.
 *
 * Options (opencode.jsonc `plugins` entry):
 *   - decorateNames: boolean   attach the line to model names (default true)
 *   - costFormat: "detailed" | "compact"   cost line format (default detailed)
 *   - aaApiKey: string         Artificial Analysis Data API key (optional;
 *                              falls back to ARTIFICIALANALYSIS_API_KEY)
 *   - refreshHours: number     score cache TTL / refresh interval in hours
 *                              (default 12, clamped to 1..596)
 */

import { Plugin } from "@opencode/plugin"
import type { CommandInvocation } from "@opencode/plugin/promise/command"
import { fetchAAScores, lookupScore, snapshotScores, type AAFetched } from "./aa.ts"
import { formatCost, pricingSegment, type CostFormat, type CostTier } from "./pricing.ts"

const CACHE_KEY = "aa-scores/v3"
const DEFAULT_REFRESH_HOURS = 12
const MIN_REFRESH_HOURS = 1
/** 596 h stays below the 2^31-1 ms setTimeout/setInterval ceiling. */
const MAX_REFRESH_HOURS = 596
/** Refuse absurdly old cache entries even if refreshHours is configured high. */
const MAX_CACHE_AGE_MS = 30 * 24 * 60 * 60_000

interface ResolvedOptions {
  decorateNames: boolean
  costFormat: CostFormat
  aaApiKey?: string
  refreshMs: number
}

interface TableModel {
  readonly id: string
  readonly modelID?: string
  readonly providerID: string
  readonly name: string
  readonly cost: readonly CostTier[] | undefined
}

function modelKey(model: TableModel): string {
  return `${model.providerID}/${model.modelID || model.id}`
}

function describeValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value)
  if (typeof value === "number" || typeof value === "boolean" || value == null) return String(value)
  return typeof value
}

/**
 * Validate user options once, with safe fallbacks. A bad option must never
 * prevent the plugin from loading.
 */
function resolveOptions(raw: unknown): ResolvedOptions {
  const options: Record<string, unknown> =
    raw !== null && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {}
  const problems: string[] = []

  let decorateNames = true
  if (options.decorateNames !== undefined) {
    if (typeof options.decorateNames === "boolean") decorateNames = options.decorateNames
    else {
      problems.push(
        `decorateNames must be a boolean (got ${describeValue(options.decorateNames)}); using true`,
      )
    }
  }

  let costFormat: CostFormat = "detailed"
  if (options.costFormat !== undefined) {
    if (options.costFormat === "detailed" || options.costFormat === "compact") {
      costFormat = options.costFormat
    } else {
      problems.push(
        `costFormat must be "detailed" or "compact" (got ${describeValue(options.costFormat)}); using "detailed"`,
      )
    }
  }

  let aaApiKey: string | undefined
  if (options.aaApiKey !== undefined) {
    if (typeof options.aaApiKey === "string") aaApiKey = options.aaApiKey || undefined
    else {
      problems.push(
        `aaApiKey must be a string (got ${describeValue(options.aaApiKey)}); using the environment fallback`,
      )
    }
  }

  let hours = DEFAULT_REFRESH_HOURS
  if (options.refreshHours !== undefined) {
    const requested = options.refreshHours
    if (typeof requested === "number" && Number.isFinite(requested) && requested > 0) {
      hours = Math.min(MAX_REFRESH_HOURS, Math.max(MIN_REFRESH_HOURS, requested))
      if (hours !== requested) {
        problems.push(
          `refreshHours ${requested} is outside ${MIN_REFRESH_HOURS}..${MAX_REFRESH_HOURS}; using ${hours}`,
        )
      }
    } else {
      problems.push(
        `refreshHours must be a finite positive number (got ${describeValue(requested)}); using ${DEFAULT_REFRESH_HOURS}`,
      )
    }
  }

  if (problems.length > 0) {
    console.warn(`[model-pricing] invalid options — ${problems.join("; ")}`)
  }

  return {
    decorateNames,
    costFormat,
    aaApiKey,
    refreshMs: Math.round(hours * 3_600_000),
  }
}

function isScoreEntry(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const entry = value as Record<string, unknown>
  if (!("score" in entry)) return false
  if (
    entry.score !== null &&
    (typeof entry.score !== "number" || !Number.isFinite(entry.score))
  ) {
    return false
  }
  if (typeof entry.name !== "string") return false
  if (entry.note !== undefined && typeof entry.note !== "string") return false
  return true
}

/** Validate a cached `AAFetched` before trusting any part of it. */
function isAAFetched(value: unknown): value is AAFetched {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const cached = value as Record<string, unknown>
  if (
    cached.scores === null ||
    typeof cached.scores !== "object" ||
    Array.isArray(cached.scores) ||
    Object.keys(cached.scores as object).length === 0
  ) {
    return false
  }
  if (typeof cached.version !== "string" || cached.version.length === 0) return false
  if (typeof cached.source !== "string" || cached.source.length === 0) return false
  if (typeof cached.fetchedAt !== "string") return false
  const fetchedAt = Date.parse(cached.fetchedAt)
  if (!Number.isFinite(fetchedAt)) return false
  // A future timestamp can otherwise pin the cache far past refreshHours.
  if (fetchedAt > Date.now()) return false
  if (Date.now() - fetchedAt > MAX_CACHE_AGE_MS) return false
  return Object.values(cached.scores as Record<string, unknown>).every(isScoreEntry)
}

/**
 * Comparison key that ignores `fetchedAt`: adopting a cache/fetch with the
 * same scores, version and source does not need a model-registry reload.
 */
function dataSignature(value: AAFetched): string {
  const entries = Object.keys(value.scores)
    .sort()
    .map((key) => {
      const entry = value.scores[key]
      return [key, entry.score, entry.name, entry.note ?? ""]
    })
  return JSON.stringify([value.version, value.source, entries])
}

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { readonly [key: string]: JsonValue }

/** Build a plain JSON value for `ctx.storage.set` (AAFetched has no index sig). */
function cachePayload(value: AAFetched): JsonValue {
  const scores: Record<string, JsonValue> = {}
  for (const [key, entry] of Object.entries(value.scores)) {
    const score: Record<string, JsonValue> = { score: entry.score, name: entry.name }
    if (entry.note !== undefined) score.note = entry.note
    scores[key] = score
  }
  return {
    scores,
    version: value.version,
    source: value.source,
    fetchedAt: value.fetchedAt,
  }
}

function markdownCell(value: unknown): string {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r\n|\r|\n/g, " ")
}

function buildTable(
  models: readonly TableModel[],
  aa: AAFetched,
  baseNames: ReadonlyMap<string, string>,
  decorateNames: boolean,
): string {
  const lines: string[] = [
    "### Model pricing & Artificial Analysis Intelligence Index",
    "",
    `Prices per 1M tokens from the live OpenCode model registry. Scores: Artificial Analysis Intelligence Index v${markdownCell(aa.version)}, source ${markdownCell(aa.source)}, fetched ${markdownCell(aa.fetchedAt.slice(0, 10))}. Attribution: https://artificialanalysis.ai/`,
    "",
    "| Model | Provider | Tier | Input | Output | Cache read | Cache write | AA Intelligence |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ]

  for (const model of models) {
    const baseName = decorateNames
      ? (baseNames.get(modelKey(model)) ?? model.name)
      : model.name
    const score = lookupScore(aa.scores, model.id, baseName)
    const aaCell =
      score?.score != null
        ? `${Math.round(score.score * 10) / 10}${score.note ? ` (${score.note})` : ""}`
        : "n/a"

    let tiers: ReturnType<typeof formatCost> = []
    try {
      tiers = formatCost(model.cost)
    } catch (error) {
      console.warn(`[model-pricing] could not format cost for ${modelKey(model)}:`, error)
    }
    const rows = tiers.length > 0 ? tiers : [undefined]
    rows.forEach((tier, index) => {
      const cells = [
        index === 0 ? baseName : "",
        index === 0 ? model.providerID : "",
        tier ? (tier.tierLabel ?? (index === 0 ? "base" : "")) : "base",
        tier ? tier.input : "n/a",
        tier ? tier.output : "n/a",
        tier ? tier.cacheRead : "n/a",
        tier ? tier.cacheWrite : "n/a",
        index === 0 ? aaCell : "",
      ]
      lines.push(`| ${cells.map(markdownCell).join(" | ")} |`)
    })
  }

  return lines.join("\n")
}

/** Remove our own decoration if a transform is replayed against a stale name. */
function undecoratedName(name: string, price: string): string {
  const suffix = ` · ${price} · AA `
  const index = name.lastIndexOf(suffix)
  if (index < 0) return name
  const tail = name.slice(index + suffix.length)
  if (tail !== "n/a" && !/^-?\d+(?:\.\d+)?$/.test(tail)) return name
  return name.slice(0, index)
}

export default Plugin.define({
  id: "model-pricing",
  async setup(ctx) {
    const options = resolveOptions(ctx.options)

    // The snapshot is usable synchronously: register the transform with it
    // before touching storage or the network so the first render is immediate.
    let aa: AAFetched = snapshotScores()
    let stopped = false
    let inFlight = false
    let timer: ReturnType<typeof setInterval> | undefined
    const abortController = new AbortController()
    // Replay-safe base names: never derive the original name by splitting the
    // decorated string, and never append the suffix twice.
    const baseNames = new Map<string, string>()

    function reloadModels(): void {
      if (!options.decorateNames || stopped) return
      try {
        void Promise.resolve(ctx.model.reload()).catch((error) =>
          console.warn("[model-pricing] model reload failed:", error),
        )
      } catch (error) {
        console.warn("[model-pricing] model reload failed:", error)
      }
    }

    function adopt(next: AAFetched): boolean {
      const changed = dataSignature(next) !== dataSignature(aa)
      aa = next
      return changed
    }

    async function readCache(): Promise<AAFetched | undefined> {
      let raw: unknown
      try {
        raw = await ctx.storage.get(CACHE_KEY)
      } catch (error) {
        console.warn("[model-pricing] AA cache read failed; continuing without it:", error)
        return undefined
      }
      if (raw === undefined) return undefined
      if (!isAAFetched(raw)) {
        console.warn("[model-pricing] ignoring invalid AA cache; using the bundled snapshot")
        return undefined
      }
      return raw
    }

    function makeAbortableFetch(): typeof fetch {
      return (input, init) => {
        const signal = init?.signal
          ? AbortSignal.any([init.signal, abortController.signal])
          : abortController.signal
        return fetch(input, { ...init, signal })
      }
    }

    async function refresh(force: boolean): Promise<void> {
      if (stopped || inFlight) return
      inFlight = true
      try {
        const cached = await readCache()
        if (stopped) return
        if (cached) {
          const age = Date.now() - Date.parse(cached.fetchedAt)
          if (age >= 0 && age < options.refreshMs) {
            if (adopt(cached)) reloadModels()
            if (!force) return
          } else if (adopt(cached)) {
            // Stale cache still beats the bundled snapshot while we refetch,
            // but it is not authoritative: always try the network below.
            reloadModels()
          }
        }

        let live: AAFetched
        try {
          live = await fetchAAScores({ apiKey: options.aaApiKey, fetchImpl: makeAbortableFetch() })
        } catch (error) {
          if (!stopped) {
            console.error("[model-pricing] live Artificial Analysis fetch failed:", error)
          }
          return
        }
        if (stopped) return

        const changed = adopt(live)
        try {
          await ctx.storage.set(CACHE_KEY, cachePayload(live))
        } catch (error) {
          // A cache write failure is not a fetch failure: keep live data.
          console.warn("[model-pricing] AA cache write failed; live data kept:", error)
        }
        if (stopped) return
        console.log(
          `[model-pricing] loaded AA Intelligence Index v${live.version} from ${live.source}`,
        )
        if (changed) reloadModels()
      } finally {
        inFlight = false
      }
    }

    if (options.decorateNames) {
      await ctx.model.transform((editor) => {
        try {
          for (const model of editor.list()) {
            try {
              const key = modelKey(model)
              const price = pricingSegment(model.cost, options.costFormat)
              let base = baseNames.get(key)
              if (base === undefined) {
                base = undecoratedName(model.name, price)
                baseNames.set(key, base)
              }
              const score = lookupScore(aa.scores, model.id, base)
              const aaSegment =
                score?.score != null ? `AA ${Math.round(score.score * 10) / 10}` : "AA n/a"
              const decorated = `${base} · ${price} · ${aaSegment}`
              if (model.name !== decorated) {
                try {
                  editor.update(model.providerID, model.id, (draft) => {
                    draft.name = decorated
                  })
                } catch (error) {
                  console.warn(
                    `[model-pricing] editor.update failed for ${key}; mutating the draft:`,
                    error,
                  )
                  model.name = decorated
                }
              }
            } catch (error) {
              // One bad registry entry must never fail the whole transform.
              console.warn("[model-pricing] could not decorate a model:", error)
            }
          }
        } catch (error) {
          console.warn("[model-pricing] model transform failed:", error)
        }
      })
    }

    // Full table as a synthetic session message (no model call needed). The
    // command is registered even when name decoration is disabled.
    await ctx.command.transform((editor) => {
      const execute = async (input: CommandInvocation): Promise<void> => {
        let models: readonly TableModel[] = []
        try {
          const { data } = await ctx.model.list()
          models = Array.isArray(data) ? data : []
        } catch (error) {
          console.warn("[model-pricing] could not list models for the pricing table:", error)
        }
        await ctx.session.synthetic({
          sessionID: input.sessionID,
          text: buildTable(models, aa, baseNames, options.decorateNames),
        })
      }
      editor.add({
        name: "model-pricing",
        description:
          "List input/output/cache prices and Artificial Analysis intelligence scores for every model",
        execute,
      })
      editor.add({
        name: "prices",
        description: "Alias of /model-pricing",
        execute,
      })
    })

    // Hydrate the cache and refresh live scores in the background. setup must
    // not wait for storage or the network; the snapshot transform is already
    // registered. Reload the registry only when the data actually changed.
    void refresh(false).catch((error) => {
      if (!stopped) console.error("[model-pricing] background refresh failed:", error)
    })

    timer = setInterval(() => {
      void refresh(true).catch((error) => {
        if (!stopped) console.error("[model-pricing] refresh failed:", error)
      })
    }, options.refreshMs)

    return () => {
      stopped = true
      if (timer !== undefined) clearInterval(timer)
      abortController.abort()
    }
  },
})
