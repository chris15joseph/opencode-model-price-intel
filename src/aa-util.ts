import { AA_INDEX_VERSION, type AAScore } from "./aa-snapshot.ts"

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Coerce finite, non-negative numbers or numeric strings; reject everything else. */
export function finiteNonNegative(value: unknown): number | null {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN
  return Number.isFinite(number) && number >= 0 ? number : null
}

/** Normalize AA's numeric (`5` / `5.1`) or string (`"5.0"`, `"v5"`) version. */
export function normalizeVersion(value: unknown, fallback = AA_INDEX_VERSION): string {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    const text = String(value)
    return text.includes(".") ? text : `${text}.0`
  }
  if (typeof value === "string") {
    const match = value.trim().match(/^v?(\d+)(?:\.(\d+))?/i)
    if (match) return `${match[1]}.${match[2] ?? "0"}`
  }
  return fallback
}

export function majorOf(version: string): string {
  return version.split(".")[0] ?? version
}

export function countNumericScores(scores: Readonly<Record<string, AAScore>>): number {
  let count = 0
  for (const entry of Object.values(scores)) if (entry.score != null) count++
  return count
}
