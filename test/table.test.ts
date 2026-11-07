/**
 * Unit tests for the pricing table sort helpers and header layout. These do
 * not render the TUI; they pin the pure row/group ordering that the dialog
 * uses when a header is clicked.
 */
import { test } from "node:test"
import assert from "node:assert/strict"

import type { PricingRow } from "../src/rpc.ts"
import { formatRows, nextSort, sortRows } from "../src/table.ts"

const rows: PricingRow[] = [
  {
    model: "Alpha",
    provider: "zeta",
    tier: "base",
    input: "10",
    output: "20",
    cache: "1/2",
    aa: "30",
  },
  // Alpha's second context tier must follow Alpha in every sort.
  {
    model: "",
    provider: "",
    tier: ">200K",
    input: "20",
    output: "30",
    cache: "2/3",
    aa: "",
  },
  {
    model: "Beta",
    provider: "alpha",
    tier: "base",
    input: "2",
    output: "5",
    cache: "0.5/1",
    aa: "40",
  },
  {
    model: "Gamma",
    provider: "alpha",
    tier: "base",
    input: "5",
    output: "7",
    cache: "—",
    aa: "n/a",
  },
]

function models(sorted: readonly PricingRow[]): string[] {
  return sorted.map((row) => row.model)
}

test("sortRows sorts model groups and keeps continuation tiers attached", () => {
  const ascending = sortRows(rows, "model", "asc")
  assert.deepEqual(models(ascending), ["Alpha", "", "Beta", "Gamma"])
  assert.equal(ascending[1].tier, ">200K")
  assert.equal(ascending[1].provider, "")

  const descending = sortRows(rows, "model", "desc")
  assert.deepEqual(models(descending), ["Gamma", "Beta", "Alpha", ""])
  assert.equal(descending[3].tier, ">200K")
})

test("non-model columns sort groups by each group's first row", () => {
  // Alpha's continuation has the highest input price, but the group sorts by
  // its first row (10), so Alpha stays after Gamma (5).
  assert.deepEqual(models(sortRows(rows, "input", "asc")), ["Beta", "Gamma", "Alpha", ""])
  assert.deepEqual(models(sortRows(rows, "input", "desc")), ["Alpha", "", "Gamma", "Beta"])

  // Cache prices compare read first, then write; unpriced rows stay last.
  assert.deepEqual(models(sortRows(rows, "cache", "asc")), ["Beta", "Alpha", "", "Gamma"])
  assert.deepEqual(models(sortRows(rows, "cache", "desc")), ["Alpha", "", "Beta", "Gamma"])

  // Ties keep registry order in both directions.
  assert.deepEqual(models(sortRows(rows, "provider", "asc")), ["Beta", "Gamma", "Alpha", ""])
  assert.deepEqual(models(sortRows(rows, "provider", "desc")), ["Alpha", "", "Beta", "Gamma"])
})

test("missing scores sort last in either direction", () => {
  assert.deepEqual(models(sortRows(rows, "aa", "asc")), ["Alpha", "", "Beta", "Gamma"])
  assert.deepEqual(models(sortRows(rows, "aa", "desc")), ["Beta", "Alpha", "", "Gamma"])
})

test("nextSort starts ascending and toggles the active column", () => {
  const first = nextSort(undefined, "aa")
  assert.deepEqual(first, { key: "aa", direction: "asc" })

  const second = nextSort(first, "aa")
  assert.deepEqual(second, { key: "aa", direction: "desc" })

  const third = nextSort(second, "aa")
  assert.deepEqual(third, { key: "aa", direction: "asc" })

  assert.deepEqual(nextSort(third, "model"), { key: "model", direction: "asc" })
})

test("formatRows exposes padded header cells and the active indicator", () => {
  const plain = formatRows(rows, 72)
  assert.ok(plain.columns.every((column) => column.direction === undefined))
  assert.ok(!plain.header.includes("▲"))
  assert.ok(!plain.header.includes("▼"))
  assert.equal(plain.header, plain.columns.map((column) => column.header).join(""))
  assert.equal(plain.separator.length, plain.header.length)

  const ascending = formatRows(rows, 72, { key: "aa", direction: "asc" })
  const aa = ascending.columns.find((column) => column.key === "aa")
  assert.ok(aa)
  assert.equal(aa.direction, "asc")
  assert.equal(aa.label, "AA ▲")
  assert.equal(aa.header, "AA ▲")
  assert.equal(ascending.header, ascending.columns.map((column) => column.header).join(""))
  assert.equal(ascending.separator.length, ascending.header.length)
  assert.ok(
    ascending.columns
      .filter((column) => column.key !== "aa")
      .every((column) => column.direction === undefined),
  )

  const descending = formatRows(rows, 72, { key: "input", direction: "desc" })
  const input = descending.columns.find((column) => column.key === "input")
  assert.ok(input)
  assert.equal(input.direction, "desc")
  assert.equal(input.label, "IN $ ▼")
})

test("header cells stay aligned with the sorted row cells", () => {
  const layout = formatRows(rows, 72, { key: "input", direction: "desc" })
  const starts: number[] = []
  let offset = 0
  for (const column of layout.columns) {
    starts.push(offset)
    offset += column.header.length
  }
  assert.equal(offset, layout.header.length)

  for (let index = 0; index < layout.columns.length - 1; index++) {
    const column = layout.columns[index]
    assert.equal(layout.header.slice(starts[index], starts[index] + column.width).length, column.width)
    for (const line of layout.lines) {
      // Row lines are trimmed on the right, but every cell before the last
      // column (including its trailing gap) is padded to the header width.
      assert.equal(line.slice(starts[index], starts[index] + column.width).length, column.width)
    }
  }
})

test("active headers keep their indicator at narrow widths", () => {
  for (const width of [24, 40, 60]) {
    const layout = formatRows(rows, width, { key: "cache", direction: "asc" })
    const cache = layout.columns.find((column) => column.key === "cache")
    assert.ok(cache)
    assert.equal(cache.label, "CACHE R/W $ ▲")
    assert.equal(cache.direction, "asc")
    assert.ok(cache.width >= cache.label.length)
    assert.equal(layout.header, layout.columns.map((column) => column.header).join(""))
    assert.equal(layout.separator.length, layout.header.length)
  }
})
