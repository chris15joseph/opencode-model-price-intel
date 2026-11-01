import { test } from "node:test"
import assert from "node:assert/strict"

import { isScrolling, marqueePhase, renderRow, SCROLL_GAP } from "../src/scroll.ts"

const base = "Qwen3.7 Plus"
const suffix = "$0.4/$1.6/$0.04/$0.5 (2 tiers) · AA n/a" // 37 chars

test("short rows render statically", () => {
  const row = renderRow("Kimi K3", "$3/$15/$0.3/$3 · AA n/a", 0, 40)
  assert.equal(row, "Kimi K3 · $3/$15/$0.3/$3 · AA n/a")
  assert.equal(isScrolling("Kimi K3", "$3/$15/$0.3/$3 · AA n/a", 40), false)
})

test("long rows scroll the detail while the model name stays pinned", () => {
  assert.equal(isScrolling(base, suffix, 40), true)
  const frame0 = renderRow(base, suffix, 0, 40)
  const frame5 = renderRow(base, suffix, 5, 40)
  // name stays visible for identification
  assert.ok(frame0.startsWith("Qwen3.7 Plus · "))
  // frames respect the width budget
  assert.equal(frame0.length, 40)
  assert.equal(frame5.length, 40)
  // and they actually move
  assert.notEqual(frame0, frame5)
  // everything is visible over one cycle, including the wrap gap
  const loop = suffix + SCROLL_GAP
  let seen = ""
  for (let offset = 0; offset < loop.length; offset++) seen += renderRow(base, suffix, offset, 40).slice(base.length + 3)
  for (const part of ["$0.4", "$1.6", "$0.04", "$0.5", "AA n/a"]) {
    assert.ok(seen.includes(part), `"${part}" never scrolled into view`)
  }
})

test("rows whose name alone overflows scroll the whole row", () => {
  const longBase = "Extremely Long Model Name Alpha"
  const row = renderRow(longBase, "$1/$2/$3/$4 · AA 5", 0, 24)
  assert.equal(row.length, 24)
  assert.equal(row, renderRow(longBase, "$1/$2/$3/$4 · AA 5", 0, 24))
  assert.notEqual(row, renderRow(longBase, "$1/$2/$3/$4 · AA 5", 3, 24))
})

test("the offset wraps around one full cycle", () => {
  const loop = suffix + SCROLL_GAP
  assert.equal(renderRow(base, suffix, 0, 40), renderRow(base, suffix, loop.length, 40))
})

test("marqueePhase animates in bursts and rests in between", () => {
  const burst = 6_000
  const pause = 20_000
  // during the burst: advance, burst window unchanged
  assert.deepEqual(marqueePhase(1_000, 6_000, burst, pause), { action: "advance", burstEndsAt: 6_000 })
  // during the rest: settle (caller repaints once, then stays quiet)
  assert.deepEqual(marqueePhase(10_000, 6_000, burst, pause), { action: "settle", burstEndsAt: 6_000 })
  // after the rest: a new burst opens
  assert.deepEqual(marqueePhase(27_000, 6_000, burst, pause), { action: "advance", burstEndsAt: 33_000 })
})

test("marqueePhase with pauseMs 0 scrolls continuously", () => {
  const phase = marqueePhase(7_000, 6_000, 6_000, 0)
  assert.equal(phase.action, "advance")
  assert.equal(phase.burstEndsAt, 13_000) // a new burst immediately
})
