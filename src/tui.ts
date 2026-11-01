/**
 * TUI part: reports the terminal width to the server part so scrolling model
 * rows are sized to the real available space (and re-sized on terminal
 * resize) instead of a fixed guess.
 *
 * The terminal UI loads this part automatically for any session whose server
 * has the plugin configured. The width is polled once per second — cheap, and
 * avoids depending on renderer internals; a report is sent when the width
 * changes and as a keepalive every 20 polls.
 */
import { Plugin } from "@opencode/plugin/tui"
import { ModelPricingRpc } from "./rpc.ts"

const POLL_MS = 1_000
const KEEPALIVE_POLLS = 20

export default Plugin.define({
  id: "model-pricing-tui",
  setup(context) {
    const clientID = `tui-${Math.random().toString(36).slice(2, 8)}`

    const widthOf = (): number => {
      const renderer = (context.renderer as { width?: number } | undefined)?.width
      return renderer ?? process.stdout.columns ?? 80
    }

    const report = (width: number): void => {
      // context.client is re-read per call: it changes when the server restarts.
      void context.client
        .rpc(ModelPricingRpc)
        .viewport({ client: clientID, width })
        .catch(() => {
          // server unreachable or plugin not registered yet — retried by poll
        })
    }

    let last = widthOf()
    let ticks = 0
    report(last)

    const timer = setInterval(() => {
      const width = widthOf()
      ticks++
      if (width !== last || ticks % KEEPALIVE_POLLS === 0) {
        last = width
        report(width)
      }
    }, POLL_MS)

    return () => clearInterval(timer)
  },
})
