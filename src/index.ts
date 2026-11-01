/**
 * opencode-model-pricing
 *
 * Makes the `/models` list show each model's input, output and cache prices
 * together with its Artificial Analysis Intelligence Index score.
 *
 * Data sources are refreshed AUTOMATICALLY before every coding session (this
 * plugin's `setup` runs while OpenCode loads plugins), because prices and
 * benchmark scores change over time:
 *
 * - Prices come from the live model registry (`Model.Info.cost`), which
 *   OpenCode refreshes from the provider catalogs at startup. Each model's
 *   `cost` tiers carry `input`, `output`, `cache.read` and `cache.write`
 *   in USD per 1M tokens.
 * - Intelligence scores are fetched from artificialanalysis.ai at startup
 *   (official Data API when `options.aaApiKey` / ARTIFICIALANALYSIS_API_KEY is
 *   set, otherwise the public model pages) and cached in plugin storage with a
 *   periodic refresh while the session is open. Attribution:
 *   https://artificialanalysis.ai/
 *
 * Because the built-in `/models` picker renders `Model.Info.name` as the row
 * title, the pricing/score line is attached to the display name so `/models`
 * lists it per model. `/model-pricing` (alias `/prices`) prints the complete
 * table — every price tier, cache read/write, and the AA score — into the
 * session.
 *
 * Options (opencode.jsonc `plugins` entry):
 *   - decorateNames: boolean   attach the line to model names (default true)
 *   - aaApiKey: string         Artificial Analysis Data API key (optional;
 *                              falls back to ARTIFICIALANALYSIS_API_KEY)
 *   - refreshHours: number     score cache TTL / refresh interval (default 12)
 */

import { Plugin } from "@opencode/plugin"
import { fetchAAScores, lookupScore, snapshotScores, type AAFetched } from "./aa.ts"
import { formatCost, pricingSegment, type CostFormat } from "./pricing.ts"
import { isScrolling, marqueePhase, renderRow } from "./scroll.ts"
import { ModelPricingRpc } from "./rpc.ts"

const CACHE_KEY = "aa-scores/v2"

interface Options {
  decorateNames?: boolean
  costFormat?: "detailed" | "compact"
  /** Marquee rows that exceed the available width instead of clipping them. */
  scroll?: boolean
  /**
   * Maximum row width in characters. Live viewport reports (TUI terminals
   * report automatically via RPC) narrow this further; the option acts as a
   * ceiling that protects clients which cannot report their width.
   */
  scrollWidth?: number
  /** Marquee tick interval in milliseconds. */
  scrollIntervalMs?: number
  /** Characters advanced per marquee tick. */
  scrollStep?: number
  /**
   * How long a scroll burst lasts. Between bursts the rows are static (no
   * repaints), so client lists keep their scroll position while you browse.
   */
  scrollBurstMs?: number
  /** Rest between bursts. `0` scrolls continuously. */
  scrollPauseMs?: number
  aaApiKey?: string
  refreshHours?: number
}

export default Plugin.define({
  id: "model-pricing",
  async setup(ctx) {
    const options = (ctx.options ?? {}) as Options
    const decorateNames = options.decorateNames !== false
    const costFormat: CostFormat = options.costFormat === "compact" ? "compact" : "detailed"
    const scroll = options.scroll === true
    const scrollWidth = Math.max(16, options.scrollWidth ?? 40)
    const scrollIntervalMs = Math.max(100, options.scrollIntervalMs ?? 500)
    const scrollStep = Math.max(1, options.scrollStep ?? 3)
    const scrollBurstMs = Math.max(scrollIntervalMs, options.scrollBurstMs ?? 6_000)
    const scrollPauseMs = Math.max(0, options.scrollPauseMs ?? 20_000)
    const refreshMs = Math.max(1, options.refreshHours ?? 12) * 3_600_000

    let scrollOffset = 0
    let scrollingActive = false

    // Live viewports reported by clients (TUI terminals report automatically
    // through the `viewport` RPC). Stale reports expire so a closed narrow
    // terminal does not keep rows short forever.
    const viewports = new Map<string, { width: number; at: number }>()
    const VIEWPORT_TTL_MS = 5 * 60_000

    function effectiveWidth(): number {
      const cutoff = Date.now() - VIEWPORT_TTL_MS
      let width = scrollWidth
      for (const [client, report] of viewports) {
        if (report.at < cutoff) {
          viewports.delete(client)
          continue
        }
        width = Math.min(width, report.width)
      }
      return Math.max(16, width)
    }

    let aa: AAFetched = snapshotScores()

    async function loadAA(force: boolean): Promise<void> {
      const cached = (await ctx.storage.get(CACHE_KEY)) as AAFetched | undefined
      const cacheFresh = cached !== undefined && Date.now() - Date.parse(cached.fetchedAt) < refreshMs
      if (cached && cacheFresh && !force) {
        aa = cached
        return
      }
      try {
        aa = await fetchAAScores({ apiKey: options.aaApiKey })
        await ctx.storage.set(CACHE_KEY, aa)
        console.log(`[model-pricing] loaded AA Intelligence Index v${aa.version} from ${aa.source}`)
      } catch (error) {
        console.error("[model-pricing] live Artificial Analysis fetch failed:", error)
        aa = cached ?? snapshotScores()
      }
    }

    // Fetch current prices/scores up front: plugin setup runs while OpenCode
    // loads plugins for the session, i.e. before the coding session begins.
    await loadAA(false)

    // Viewport reports size the scrolling rows to the real available space.
    let lastWidth = effectiveWidth()
    const rpcRegistration = await ctx.rpc.register(ModelPricingRpc, {
      viewport: async (input) => {
        const { client = "anonymous", width } = input as { client?: string; width: number }
        viewports.set(client, { width, at: Date.now() })
        const next = effectiveWidth()
        if (next !== lastWidth) {
          lastWidth = next
          void ctx.model.reload().catch(() => {})
        }
        return { width: next }
      },
    })

    if (decorateNames) {
      await ctx.model.transform((editor) => {
        let anyScrolling = false
        const width = effectiveWidth()
        for (const model of editor.list()) {
          const score = lookupScore(aa.scores, model.id, model.name)
          const aaSegment = score?.score != null ? `AA ${Math.round(score.score * 10) / 10}` : "AA n/a"
          const suffix = `${pricingSegment(model.cost, costFormat)} · ${aaSegment}`
          if (scroll && isScrolling(model.name, suffix, width)) {
            anyScrolling = true
            model.name = renderRow(model.name, suffix, scrollOffset, width)
          } else {
            model.name = `${model.name} · ${suffix}`
          }
        }
        scrollingActive = anyScrolling
      })
    }

    // Full table as a synthetic session message (no model call needed).
    await ctx.command.transform((editor) => {
      const execute = async (input: {
        sessionID: string
      }): Promise<void> => {
        const models = await ctx.model.list()
        const lines: string[] = [
          "### Model pricing & Artificial Analysis Intelligence Index",
          "",
          "Prices per 1M tokens from the live OpenCode model registry (fetched before this session). Scores: Artificial Analysis Intelligence Index, source https://artificialanalysis.ai/ (index v" +
            aa.version +
            ", fetched " +
            aa.fetchedAt.slice(0, 10) +
            ").",
          "",
          "| Model | Provider | Tier | Input | Output | Cache read | Cache write | AA Intelligence |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
        ]
        for (const model of models) {
          // `model.name` may carry the decoration/scroll window; the base name
          // is the part before the first " · ".
          const baseName = model.name.split(" · ")[0]
          const score = lookupScore(aa.scores, model.id, baseName)
          const aaCell =
            score?.score != null
              ? `${Math.round(score.score * 10) / 10}${score.note ? ` (${score.note})` : ""}`
              : "n/a"
          const tiers = formatCost(model.cost)
          const rows = tiers.length > 0 ? tiers : [undefined]
          rows.forEach((tier, index) => {
            const cells = tier
              ? [
                  tier.tierLabel ?? (index === 0 ? "" : ""),
                  tier.input,
                  tier.output,
                  tier.cacheRead,
                  tier.cacheWrite,
                ]
              : ["", "n/a", "n/a", "n/a", "n/a"]
            lines.push(
              `| ${index === 0 ? baseName : ""} | ${index === 0 ? model.providerID : ""} | ${cells[0] || "base"} | ${cells[1]} | ${cells[2]} | ${cells[3]} | ${cells[4]} | ${index === 0 ? aaCell : ""} |`,
            )
          })
        }
        await ctx.session.synthetic({
          sessionID: input.sessionID,
          text: lines.join("\n"),
        })
      }
      editor.add({
        name: "model-pricing",
        description: "List input/output/cache prices and Artificial Analysis intelligence scores for every model",
        execute,
      })
      editor.add({
        name: "prices",
        description: "Alias of /model-pricing",
        execute,
      })
    })

    // Scores change over time: keep refreshing while the session is open.
    const timer = setInterval(() => {
      void loadAA(true)
        .then(() => ctx.model.reload())
        .catch((error) => console.error("[model-pricing] refresh failed:", error))
    }, refreshMs)

    // Marquee tick: advance the window offset and repaint — in bursts. Between
    // bursts the rows settle at their head frame (model name first) and the
    // registry is left untouched, so client lists keep their scroll position.
    let burstEndsAt = Date.now() + scrollBurstMs
    const scrollTimer = setInterval(() => {
      if (!scroll || !scrollingActive) return
      const phase = marqueePhase(Date.now(), burstEndsAt, scrollBurstMs, scrollPauseMs)
      burstEndsAt = phase.burstEndsAt
      if (phase.action === "advance") {
        scrollOffset = (scrollOffset + scrollStep) % 100_000
        void ctx.model.reload().catch((error) => console.error("[model-pricing] scroll tick failed:", error))
      } else if (scrollOffset !== 0) {
        scrollOffset = 0 // settle once at the head frame; no further repaints
        void ctx.model.reload().catch((error) => console.error("[model-pricing] scroll tick failed:", error))
      }
    }, scrollIntervalMs)

    return () => {
      clearInterval(timer)
      clearInterval(scrollTimer)
      void rpcRegistration.dispose()
    }
  },
})
