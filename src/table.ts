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

export type SortDirection = "asc" | "desc"

/** The active sort column and direction. Model groups sort together. */
export interface SortState {
  readonly key: keyof PricingRow
  readonly direction: SortDirection
}

/** One header cell, including the gap that follows it. */
export interface PricingTableColumn {
  readonly key: keyof PricingRow
  /** Header text plus the direction indicator when this column is sorted. */
  readonly label: string
  /** Cell width, not counting the inter-column gap. */
  readonly width: number
  readonly align: "left" | "right"
  /** Padded header cell followed by `COLUMN_GAP` (empty on the last cell). */
  readonly header: string
  /** Set only for the active sort column. */
  readonly direction?: SortDirection
}

export interface PricingTableLayout {
  /** Header row, already padded to the chosen column widths. */
  readonly header: string
  /** A rule under the header, one character per header cell. */
  readonly separator: string
  /** One aligned line per pricing row. */
  readonly lines: readonly string[]
  /** Per-column layout, used by the TUI to make headers clickable. */
  readonly columns: readonly PricingTableColumn[]
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

/**
 * Toggle a sort: the first click on a column sorts ascending, a second click
 * on the same column flips the direction, and a different column starts over.
 */
export function nextSort(current: SortState | undefined, key: keyof PricingRow): SortState {
  if (current?.key === key) {
    return { key, direction: current.direction === "asc" ? "desc" : "asc" }
  }
  return { key, direction: "asc" }
}

interface RowGroup {
  readonly rows: PricingRow[]
  readonly index: number
}

/**
 * Split the flat row list into model groups. A non-empty model starts a group;
 * blank model cells are continuation tiers and stay with the group above.
 */
function groupRows(rows: readonly PricingRow[]): RowGroup[] {
  const groups: RowGroup[] = []
  for (const row of rows) {
    if (row.model !== "" || groups.length === 0) {
      groups.push({ rows: [row], index: groups.length })
    } else {
      groups[groups.length - 1].rows.push(row)
    }
  }
  return groups
}

type Sortable =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "number"; readonly values: readonly number[] }
  | { readonly kind: "missing" }

function sortable(value: string, key: keyof PricingRow): Sortable {
  const text = value.trim()
  if (key === "model" || key === "provider" || key === "tier") {
    return { kind: "text", text }
  }
  if (text === "" || text === "—" || text === "?" || text.toLowerCase() === "n/a") {
    return { kind: "missing" }
  }

  // Cache cells are "read/write", so compare the read price first and use the
  // write price as a tie-breaker. Other numeric cells are a single value.
  const parts = key === "cache" ? text.split("/") : [text]
  const values: number[] = []
  for (const part of parts) {
    const token = part.trim().replace(/^\$/, "").replace(/^</, "")
    if (token.toLowerCase() === "free") {
      values.push(0)
      continue
    }
    const match = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i.exec(token)
    const number = match ? Number(match[0]) : Number.NaN
    if (!Number.isFinite(number)) return { kind: "missing" }
    values.push(number)
  }
  return { kind: "number", values }
}

function compareText(left: string, right: string): number {
  const a = left.toLowerCase()
  const b = right.toLowerCase()
  if (a < b) return -1
  if (a > b) return 1
  if (left === right) return 0
  return left < right ? -1 : 1
}

function compareSortable(left: Sortable, right: Sortable): number {
  if (left.kind === "text" && right.kind === "text") {
    return compareText(left.text, right.text)
  }
  if (left.kind === "number" && right.kind === "number") {
    const length = Math.max(left.values.length, right.values.length)
    for (let index = 0; index < length; index++) {
      const a = left.values[index]
      const b = right.values[index]
      if (a === b) continue
      if (a === undefined) return -1
      if (b === undefined) return 1
      return a < b ? -1 : 1
    }
    return 0
  }
  return 0
}

/**
 * Sort model groups by one column while keeping continuation tiers attached.
 * Sorting is stable: registry order survives ties in both directions, and
 * missing/unpriced values sort last regardless of direction.
 */
export function sortRows(
  rows: readonly PricingRow[],
  key: keyof PricingRow,
  direction: SortDirection = "asc",
): PricingRow[] {
  const groups = groupRows(rows)
  groups.sort((left, right) => {
    const a = sortable(left.rows[0][key], key)
    const b = sortable(right.rows[0][key], key)
    if (a.kind === "missing" || b.kind === "missing") {
      if (a.kind === b.kind) return left.index - right.index
      return a.kind === "missing" ? 1 : -1
    }
    const comparison = compareSortable(a, b)
    if (comparison !== 0) {
      return direction === "asc" ? comparison : -comparison
    }
    return left.index - right.index
  })
  return groups.flatMap((group) => group.rows)
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

function headerLabel(column: Column, sort: SortState | undefined): string {
  if (sort?.key !== column.key) return column.header
  return `${column.header} ${sort.direction === "asc" ? "▲" : "▼"}`
}

function columnWidths(
  rows: readonly PricingRow[],
  width: number,
  sort: SortState | undefined,
): Record<keyof PricingRow, number> {
  const natural = {} as Record<keyof PricingRow, number>
  for (const column of COLUMNS) {
    let widest = headerLabel(column, sort).length
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
  sort?: SortState,
): PricingTableLayout {
  const safeWidth = Math.max(24, Math.floor(width))
  const widths = columnWidths(rows, safeWidth, sort)
  const line = (cells: Readonly<Record<keyof PricingRow, string>>, trim: boolean): string => {
    const rendered = COLUMNS.map((column) =>
      fit(cells[column.key], widths[column.key], column.align),
    ).join(COLUMN_GAP)
    return trim ? rendered.trimEnd() : rendered
  }

  const columns = COLUMNS.map((column, index): PricingTableColumn => {
    const label = headerLabel(column, sort)
    const gap = index === COLUMNS.length - 1 ? "" : COLUMN_GAP
    return {
      key: column.key,
      label: oneLine(label),
      width: widths[column.key],
      align: column.align,
      header: `${fit(label, widths[column.key], column.align)}${gap}`,
      direction: sort?.key === column.key ? sort.direction : undefined,
    }
  })
  const header = columns.map((column) => column.header).join("")

  return {
    header,
    separator: "─".repeat(header.length),
    lines: rows.map((row) => line(row, true)),
    columns,
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
