import type { CostFormat } from "./pricing.ts"

const DEFAULT_REFRESH_HOURS = 12
const MIN_REFRESH_HOURS = 1
/** 596 h stays below the 2^31-1 ms setTimeout/setInterval ceiling. */
const MAX_REFRESH_HOURS = 596

export interface ResolvedOptions {
  decorateNames: boolean
  costFormat: CostFormat
  aaApiKey?: string
  refreshMs: number
}

export function describeValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value)
  if (typeof value === "number" || typeof value === "boolean" || value == null) return String(value)
  return typeof value
}

/**
 * Validate user options once, with safe fallbacks. A bad option must never
 * prevent the plugin from loading.
 */
export function resolveOptions(raw: unknown): ResolvedOptions {
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
