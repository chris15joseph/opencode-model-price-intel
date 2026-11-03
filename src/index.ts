/**
 * opencode-model-pricing
 *
 * Shows each model's input, output and cache prices together with its
 * Artificial Analysis Intelligence Index score. Prices come from the live
 * model registry (`Model.Info.cost`); scores are fetched from
 * artificialanalysis.ai and cached in plugin storage, with a periodic refresh
 * while the session is open. Attribution: https://artificialanalysis.ai/
 *
 * Because the built-in `/models` picker renders `Model.Info.name` as the row
 * title, the pricing/score line is attached to the display name.
 * `/model-pricing` (alias `/prices`) prints the complete table — every price
 * tier, cache read/write, and the AA score — into the session.
 */

import { Plugin } from "@opencode/plugin"
import type { CommandInvocation } from "@opencode/plugin/promise/command"
import { fetchAAScores, lookupScore, snapshotScores, type AAFetched } from "./aa.ts"
import { CACHE_KEY, cachePayload, dataSignature, isAAFetched } from "./cache.ts"
import { resolveOptions } from "./options.ts"
import { pricingSegment } from "./pricing.ts"
import { buildTable, modelKey, undecoratedName, type TableModel } from "./table.ts"

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
