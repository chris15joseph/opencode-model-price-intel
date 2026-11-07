/**
 * Formatting helpers for model pricing.
 *
 * Prices come from the LIVE model registry (`Model.Info.cost`), which OpenCode
 * refreshes from provider catalogs — not from a bundled table. This module only
 * formats and packages those values.
 *
 * `Model.Cost` shape (OpenCode schema):
 *   {
 *     tier?: { type: "context", size: number }   // applies ABOVE `size` context tokens
 *     input: number                              // USD per 1M tokens
 *     output: number
 *     cache: { read: number, write: number }
 *   }
 * `Model.Info.cost` is an ARRAY of such entries: an untiered base price
 * followed by zero or more context overrides. OpenCode selects the matching
 * override when context tokens exceed `tier.size`.
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
  /** e.g. ">32K" when the entry is a context-tier override. */
  tierLabel?: string
  /** True only when input, output, cache read and cache write are all 0. */
  free: boolean
}

/** Expand exponent notation so prices never render as `1e+21`. */
function plainDecimal(value: number): string {
  const text = String(value)
  const match = text.match(/^(-?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/i)
  if (!match) return text
  const [, sign, whole, fraction = "", rawExponent] = match
  const exponent = Number(rawExponent)
  const digits = whole + fraction
  if (exponent >= 0) {
    const zeros = exponent - fraction.length
    if (zeros >= 0) return `${sign}${digits}${"0".repeat(zeros)}`
    const split = digits.length + zeros
    return `${sign}${digits.slice(0, split)}.${digits.slice(split)}`
  }
  const zeros = -exponent - whole.length
  if (zeros >= 0) return `${sign}0.${"0".repeat(zeros)}${digits}`
  const split = whole.length + exponent
  return `${sign}${whole.slice(0, split)}.${whole.slice(split)}${fraction}`
}

/**
 * Format a USD-per-1M-token price, preserving published precision:
 * 10 -> "$10", 0.006 -> "$0.006", 0.003625 -> "$0.003625".
 * Prices below $0.00005 render explicitly as "<$0.00005"; negative or
 * non-finite values render "?".
 */
export function usd(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "?"
  if (value === 0) return "$0"
  if (value < 0.00005) return "<$0.00005"
  // Registry prices are exact JSON decimals; this only removes floating-point
  // noise from arithmetic while keeping every published digit.
  const normalized = value < 1 ? Math.round(value * 1e12) / 1e12 : value
  let text = plainDecimal(normalized)
  if (text.includes(".")) text = text.replace(/0+$/, "").replace(/\.$/, "")
  return `$${text}`
}

function contextBound(size: number): string {
  if (Number.isFinite(size) && size >= 1_000 && size % 1_000 === 0) {
    return `${size / 1_000}K`
  }
  return String(size)
}

function tierLabelFor(tier: CostTier): string | undefined {
  // An entry with tier.type === "context" applies ABOVE tier.size.
  if (tier.tier?.type !== "context") return undefined
  return `>${contextBound(tier.tier.size)}`
}

function isFree(tier: CostTier): boolean {
  return (
    tier.input === 0 &&
    tier.output === 0 &&
    (tier.cache?.read ?? 0) === 0 &&
    (tier.cache?.write ?? 0) === 0
  )
}

export function formatTier(tier: CostTier, _index = 0, _all: readonly CostTier[] = [tier]): FormattedPrice {
  return {
    input: usd(tier.input),
    output: usd(tier.output),
    cacheRead: usd(tier.cache?.read ?? 0),
    cacheWrite: usd(tier.cache?.write ?? 0),
    tierLabel: tierLabelFor(tier),
    free: isFree(tier),
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
 * and an `(N tiers)` marker.
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
