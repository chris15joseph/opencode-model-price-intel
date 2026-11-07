/**
 * Pricing table data and rendering shared by the server RPC and the TUI
 * dialog. The server owns the live registry and AA cache; the TUI only lays
 * the returned rows out for the current terminal width.
 */

import { lookupScore, type AAFetched } from "./aa.ts"
import { formatCost, type CostTier } from "./pricing.ts"
import type { PricingRow } from "./rpc.ts"

export interface TableModel {
  readonly id: string
  readonly modelID?: string
  readonly providerID: string
  readonly name: string
  readonly cost: readonly CostTier[] | undefined
}

/** Everything the TUI needs to draw the table, minus the pre-rendered text. */
export interface PricingDataset {
  readonly title: string
  readonly meta: string
  readonly footnote: string
  readonly rows: readonly PricingRow[]
}

export interface PricingTableLayout {
  /** Header row, already padded to the chosen column widths. */
  readonly header: string
  /** A rule under the header, one character per header cell. */
  readonly separator: string
  /** One aligned line per pricing row. */
  readonly lines: readonly string[]
}

/** Fallback width used by the RPC `text` field and `dialog.alert`. */
export const DEFAULT_TABLE_WIDTH = 108

const TITLE = "Model pricing & Artificial Analysis Intelligence Index"
const FOOTNOTE =
  "AA: * bundled v5 snapshot; ~ other match note (variant or entry name). Attribution: https://artificialanalysis.ai/"
const COLUMN_GAP = "  "

interface Column {
  readonly key: keyof PricingRow
  readonly header: string
  readonly align: "left" | "right"
  readonly min: number
  readonly max: number
}

const COLUMNS: readonly Column[] = [
  { key: "model", header: "MODEL", align: "left", min: 10, max: 56 },
  { key: "provider", header: "PROVIDER", align: "left", min: 6, max: 14 },
  { key: "tier", header: "TIER", align: "left", min: 4, max: 9 },
  { key: "input", header: "IN $", align: "right", min: 3, max: 12 },
  { key: "output", header: "OUT $", align: "right", min: 3, max: 12 },
  { key: "cache", header: "CACHE R/W $", align: "right", min: 7, max: 18 },
  { key: "aa", header: "AA", align: "right", min: 2, max: 6 },
]

function modelKey(model: TableModel): string {
  return `${model.providerID}/${model.modelID || model.id}`
}

/** Keep one physical line per cell. */
function oneLine(value: unknown): string {
  return String(value ?? "")
    .replace(/\r\n|\r|\n/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** Drop the currency sign; the column header already states the unit. */
function price(value: string): string {
  return value.startsWith("$") ? value.slice(1) : value
}

function aaCell(score: ReturnType<typeof lookupScore>): string {
  if (score?.score == null) return "n/a"
  const value = String(Math.round(score.score * 10) / 10)
  if (!score.note) return value
  return `${value}${score.note.includes("[snapshot]") ? "*" : "~"}`
}

/**
 * Build the grouped table rows. The model and provider are written once per
 * model; extra context tiers continue underneath with those columns blank.
 */
export function pricingData(
  models: readonly TableModel[],
  aa: AAFetched,
  baseNames: ReadonlyMap<string, string>,
  decorateNames: boolean,
): PricingDataset {
  const rows: PricingRow[] = []

  for (const model of models) {
    const key = modelKey(model)
    const baseName = decorateNames ? (baseNames.get(key) ?? model.name) : model.name
    const score = lookupScore(aa.scores, model.id, baseName)
    const aaValue = aaCell(score)

    let tiers: ReturnType<typeof formatCost> = []
    try {
      tiers = formatCost(model.cost)
    } catch (error) {
      console.warn(`[model-price-intel] could not format cost for ${key}:`, error)
    }

    if (tiers.length === 0) {
      rows.push({
        model: oneLine(baseName),
        provider: oneLine(model.providerID),
        tier: "base",
        input: "n/a",
        output: "—",
        cache: "—",
        aa: aaValue,
      })
      continue
    }

    tiers.forEach((tier, index) => {
      const first = index === 0
      rows.push({
        model: first ? oneLine(baseName) : "",
        provider: first ? oneLine(model.providerID) : "",
        tier: oneLine(tier.tierLabel ?? "base"),
        input: tier.free ? "free" : price(tier.input),
        output: tier.free ? "—" : price(tier.output),
        cache: tier.free ? "—" : `${price(tier.cacheRead)}/${price(tier.cacheWrite)}`,
        aa: first ? aaValue : "",
      })
    })
  }

  return {
    title: TITLE,
    meta: `Prices per 1M tokens (USD) from the live OpenCode model registry.\nScores: Artificial Analysis Intelligence Index v${aa.version}.\nSource: ${aa.source}, fetched ${aa.fetchedAt.slice(0, 10)}.`,
    footnote: FOOTNOTE,
    rows,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** Shorten a cell to the column width, keeping one cell for the ellipsis. */
function truncate(value: string, width: number): string {
  if (value.length <= width) return value
  if (width <= 1) return "…".slice(0, width)
  return `${value.slice(0, width - 1)}…`
}

function fit(value: string, width: number, align: "left" | "right"): string {
  const text = truncate(oneLine(value), width)
  const padding = " ".repeat(Math.max(0, width - text.length))
  return align === "right" ? `${padding}${text}` : `${text}${padding}`
}

function columnWidths(rows: readonly PricingRow[], width: number): Record<keyof PricingRow, number> {
  const natural = {} as Record<keyof PricingRow, number>
  for (const column of COLUMNS) {
    let widest = column.header.length
    for (const row of rows) widest = Math.max(widest, row[column.key].length)
    natural[column.key] = clamp(widest, column.min, column.max)
  }

  // Give the leftover space to the model column so the table spans the dialog
  // instead of leaving a ragged right edge. When space is tight, truncating the
  // model name is preferable to overlapping the numeric columns.
  const gaps = COLUMN_GAP.length * (COLUMNS.length - 1)
  const fixed = COLUMNS.reduce(
    (total, column) => total + (column.key === "model" ? 0 : natural[column.key]),
    gaps,
  )
  const available = Math.max(0, width - fixed)
  natural.model = clamp(available, COLUMNS[0].min, COLUMNS[0].max)

  return natural
}

/** Lay the rows out as a monospace table for the given total width. */
export function formatRows(
  rows: readonly PricingRow[],
  width: number = DEFAULT_TABLE_WIDTH,
): PricingTableLayout {
  const safeWidth = Math.max(24, Math.floor(width))
  const widths = columnWidths(rows, safeWidth)
  const line = (cells: Readonly<Record<keyof PricingRow, string>>, trim: boolean): string => {
    const rendered = COLUMNS.map((column) =>
      fit(cells[column.key], widths[column.key], column.align),
    ).join(COLUMN_GAP)
    return trim ? rendered.trimEnd() : rendered
  }

  const headerCells = Object.fromEntries(
    COLUMNS.map((column) => [column.key, column.header]),
  ) as Record<keyof PricingRow, string>
  const header = line(headerCells, false)

  return {
    header,
    separator: "─".repeat(header.length),
    lines: rows.map((row) => line(row, true)),
  }
}

/** Render the full text table used by the RPC fallback and tests. */
export function renderTable(
  data: PricingDataset,
  width: number = DEFAULT_TABLE_WIDTH,
): string {
  const layout = formatRows(data.rows, width)
  return [
    data.title,
    "",
    data.meta,
    "",
    layout.header,
    layout.separator,
    ...layout.lines,
    "",
    data.footnote,
  ].join("\n")
}

/**
 * Backwards-compatible text helper: build the dataset and render it at the
 * default width.
 */
export function buildTable(
  models: readonly TableModel[],
  aa: AAFetched,
  baseNames: ReadonlyMap<string, string>,
  decorateNames: boolean,
): string {
  return renderTable(pricingData(models, aa, baseNames, decorateNames))
}
