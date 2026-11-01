/**
 * Marquee burst scheduler.
 *
 * Constant name updates make clients re-render their model list, which resets
 * the user's scroll position while they browse it. So the marquee runs in
 * bursts: it animates for `burstMs` (roughly one full reveal of every row),
 * then rests for `pauseMs` — during the rest there are no repaints at all and
 * the list is stable. `pauseMs: 0` restores continuous scrolling.
 */
export type MarqueeAction = "advance" | "settle"

export function marqueePhase(
  now: number,
  burstEndsAt: number,
  burstMs: number,
  pauseMs: number,
): { action: MarqueeAction; burstEndsAt: number } {
  if (now < burstEndsAt) return { action: "advance", burstEndsAt }
  if (pauseMs > 0 && now < burstEndsAt + pauseMs) return { action: "settle", burstEndsAt }
  return { action: "advance", burstEndsAt: now + burstMs }
}

/**
 * Scrolling (marquee) rows for narrow screens.
 *
 * When a decorated model row exceeds the available width (e.g. mobile web
 * sessions, where long rows got concatenated), the row becomes a marquee
 * instead of being clipped:
 *
 * - The model name stays pinned so the model can still be identified while
 *   the row scrolls.
 * - The trailing detail (cost + AA score) slides through a fixed window,
 *   wrapping around with a gap marker (" ⋯ ") so every part becomes visible.
 * - If the model name alone does not fit, the whole row scrolls instead.
 *
 * The window offset advances one character per tick; the plugin calls
 * `ctx.model.reload()` on an interval to repaint.
 */

export const SCROLL_GAP = " ⋯ "

function windowOf(loop: string, offset: number, width: number): string {
  let out = ""
  for (let i = 0; i < width; i++) out += loop[(offset + i) % loop.length]
  return out
}

/** Whether the rendered row needs to scroll at this width. */
export function isScrolling(base: string, suffix: string, width: number): boolean {
  return `${base} · ${suffix}`.length > width
}

/**
 * Render one frame of the row.
 *
 *   base   the model's own name (kept pinned when it fits)
 *   suffix the sliding detail, e.g. "$0.4/$0.5/$0.01/$0.05 · AA 32.5"
 *   offset the current marquee offset in characters
 *   width  the maximum row width in characters
 */
export function renderRow(base: string, suffix: string, offset: number, width: number): string {
  const full = `${base} · ${suffix}`
  if (full.length <= width) return full

  const pinnedBudget = width - base.length - 3 // " · "
  if (pinnedBudget >= 8) {
    const loop = suffix + SCROLL_GAP
    return `${base} · ${windowOf(loop, offset % loop.length, pinnedBudget)}`
  }
  // Name alone overflows: scroll the entire row.
  const loop = full + SCROLL_GAP
  return windowOf(loop, offset % loop.length, width)
}
