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
 * Note: an experimental scrolling (marquee) mode for narrow screens existed
 * here and was removed — periodic name repaints made client lists reset their
 * scroll position (both the TUI and the web UI). Names are therefore static.
 *
 * Options (opencode.jsonc `plugins` entry):
 *   - decorateNames: boolean   attach the line to model names (default true)
 *   - costFormat: "detailed" | "compact"   cost line format (default detailed)
 *   - aaApiKey: string         Artificial Analysis Data API key (optional;
 *                              falls back to ARTIFICIALANALYSIS_API_KEY)
 *   - refreshHours: number     score cache TTL / refresh interval (default 12)
 */

import { Plugin } from "@opencode/plugin"
import { fetchAAScores, lookupScore, snapshotScores, type AAFetched } from "./aa.ts"
import { formatCost, pricingSegment, type CostFormat } from "./pricing.ts"

const CACHE_KEY = "aa-scores/v2"

interface Options {
  decorateNames?: boolean
  costFormat?: "detailed" | "compact"
  aaApiKey?: string
  refreshHours?: number
}

export default Plugin.define({
  id: "model-pricing",
  async setup(ctx) {
    const options = (ctx.options ?? {}) as Options
    const decorateNames = options.decorateNames !== false
    const costFormat: CostFormat = options.costFormat === "compact" ? "compact" : "detailed"
    const refreshMs = Math.max(1, options.refreshHours ?? 12) * 3_600_000

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

    if (decorateNames) {
      await ctx.model.transform((editor) => {
        for (const model of editor.list()) {
          const score = lookupScore(aa.scores, model.id, model.name)
          const aaSegment = score?.score != null ? `AA ${Math.round(score.score * 10) / 10}` : "AA n/a"
          model.name = `${model.name} · ${pricingSegment(model.cost, costFormat)} · ${aaSegment}`
        }
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
          // `model.name` carries the decoration; the base name is the part
          // before the first " · ".
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

    return () => clearInterval(timer)
  },
})
