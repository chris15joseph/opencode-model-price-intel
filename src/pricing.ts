/**
 * Formatting helpers for model pricing.
 *
 * Prices come from the LIVE model registry (`Model.Info.cost`), which OpenCode
 * refreshes from provider catalogs — not from a bundled table. This module only
 * formats and packages those values.
 *
 * `Model.Cost` shape (OpenCode schema):
 *   {
 *     tier?: { type: "context", size: number }   // applies up to `size` context tokens
 *     input: number                              // USD per 1M tokens
 *     output: number
 *     cache: { read: number, write: number }
 *   }
 * `Model.Info.cost` is an ARRAY of such entries (one per context-price tier).
 */

export interface CostTier {
  tier?: { type: string; size: number }
  input: number
  output: number
  cache: { read: number; write: number }
}

export interface FormattedPrice {
  input: string
  output: string
  cacheRead: string
  cacheWrite: string
  /** e.g. "≤272K" / ">272K" when the entry is context-tiered. */
  tierLabel?: string
  free: boolean
}

/** Format a USD-per-1M-token price compactly: 10 -> "$10", 0.006 -> "$0.006". */
export function usd(value: number): string {
  if (!Number.isFinite(value)) return "?"
  if (value === 0) return "$0"
  const rounded = Math.round(value * 10_000) / 10_000
  return `$${String(rounded)}`
}

function tierLabelFor(tier: CostTier, index: number, all: readonly CostTier[]): string | undefined {
  if (!tier.tier) return undefined
  // First tier caps at its own size; later tiers cover above the previous cap.
  const size = index === 0 ? tier.tier.size : all[index - 1]?.tier?.size ?? tier.tier.size
  const bound = size >= 1000 ? `${Math.round(size / 1000)}K` : String(size)
  return index === 0 ? `≤${bound}` : `>${bound}`
}

export function formatTier(tier: CostTier, index = 0, all: readonly CostTier[] = [tier]): FormattedPrice {
  const free = tier.input === 0 && tier.output === 0
  return {
    input: usd(tier.input),
    output: usd(tier.output),
    cacheRead: usd(tier.cache?.read ?? 0),
    cacheWrite: usd(tier.cache?.write ?? 0),
    tierLabel: tierLabelFor(tier, index, all),
    free,
  }
}

export function formatCost(cost: readonly CostTier[] | undefined): FormattedPrice[] {
  return (cost ?? []).map((tier, index, all) => formatTier(tier, index, all))
}

/** How the per-model cost line is rendered in `/models`. */
export type CostFormat = "detailed" | "compact"

/**
 * Compact per-model line used to decorate the model's display name so the
 * built-in `/models` picker lists input, output and cache prices plus the
 * Artificial Analysis intelligence score:
 *
 *   detailed: "GPT 6 Astra · in $10 out $50 · cache read $1 write $12.5 · AA 56.9"
 *   compact:  "GPT 6 Astra · $10/$50/$1/$12.5 · AA 56.9"
 *   free:     "Big Pickle · free · AA n/a"
 *
 * The compact form (<in>/<out>/<read>/<write>) keeps rows readable on narrow
 * screens such as mobile web sessions. Multi-tier models show their base tier
 * and a marker pointing at the `/model-pricing` command, which lists every
 * tier.
 */
export function pricingSegment(
  cost: readonly CostTier[] | undefined,
  format: CostFormat = "detailed",
): string {
  const tiers = formatCost(cost)
  const base = tiers[0]
  if (!base) return format === "compact" ? "n/a" : "pricing n/a"
  if (base.free && tiers.every((tier) => tier.free)) return "free"
  const tierSuffix = tiers.length > 1 ? ` (${tiers.length} tiers)` : ""
  if (format === "compact") {
    return `${base.input}/${base.output}/${base.cacheRead}/${base.cacheWrite}${tierSuffix}`
  }
  return `in ${base.input} out ${base.output} · cache read ${base.cacheRead} write ${base.cacheWrite}${tierSuffix}`
}
