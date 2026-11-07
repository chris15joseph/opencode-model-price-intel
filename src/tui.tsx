/**
 * TUI part: `/model-pricing` and `/prices` open a native dialog table.
 *
 * A dialog (rather than a session panel) keeps the right side of the session
 * usable and inherits the built-in dialog behavior: scrolling, Escape,
 * backdrop-click to close, and modal focus. The table rows come from the
 * server over RPC because only the server owns the live registry and AA cache.
 */

import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { For, Show, createMemo, createSignal } from "solid-js"
import { ModelPricing, type PricingTable } from "./rpc.ts"
import {
  DEFAULT_TABLE_WIDTH,
  formatRows,
  nextSort,
  sortRows,
  type SortState,
} from "./table.ts"

function PricingDialog(props: {
  readonly table: () => PricingTable | undefined
  readonly onClose: () => void
}) {
  const context = usePlugin()
  const dimensions = useTerminalDimensions()
  const theme = context.theme.surface("dialog")
  const width = () => Math.max(40, Math.min(DEFAULT_TABLE_WIDTH, dimensions().width - 10))
  const maxHeight = () => Math.max(5, Math.floor(dimensions().height / 2) - 6)
  const [sort, setSort] = createSignal<SortState | undefined>()
  const sortBy = (key: SortState["key"]) => setSort((current) => nextSort(current, key))

  const focus = (scroll: ScrollBoxRenderable) => {
    // The dialog has no search input, so give the table keyboard focus.
    setTimeout(() => {
      if (!scroll.isDestroyed) scroll.focus()
    }, 1)
  }

  return (
    <box flexDirection="column" paddingLeft={3} paddingRight={3} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text.base}>
          Model pricing &amp; AA Intelligence Index
        </text>
        <text fg={theme.text.muted} onMouseUp={props.onClose}>
          esc
        </text>
      </box>
      <Show
        when={props.table()}
        fallback={<text fg={theme.text.muted}>Loading model pricing…</text>}
      >
        {(table: () => PricingTable) => {
          const layout = createMemo(() => {
            const state = sort()
            const rows = state
              ? sortRows(table().rows, state.key, state.direction)
              : table().rows
            return formatRows(rows, width(), state)
          })
          return (
            <>
              <text fg={theme.text.muted} wrapMode="word">
                {table().meta}
              </text>
              <box flexDirection="column">
                <box flexDirection="row" flexShrink={0}>
                  <For each={layout().columns}>
                    {(column) => (
                      <text
                        attributes={TextAttributes.BOLD}
                        fg={column.direction ? theme.text.base : theme.text.muted}
                        wrapMode="none"
                        flexShrink={0}
                        onMouseUp={(event) => {
                          // The host closes on a backdrop click; a header click
                          // must only change the sort order.
                          event.preventDefault()
                          event.stopPropagation()
                          sortBy(column.key)
                        }}
                      >
                        {column.header}
                      </text>
                    )}
                  </For>
                </box>
                <text fg={theme.text.faint} wrapMode="none">
                  {layout().separator}
                </text>
                <scrollbox
                  ref={focus}
                  maxHeight={maxHeight()}
                  scrollX
                  scrollbarOptions={{ visible: true }}
                  horizontalScrollbarOptions={{ visible: false }}
                >
                  <Show
                    when={layout().lines.length > 0}
                    fallback={<text fg={theme.text.muted}>No models available.</text>}
                  >
                    <For each={layout().lines}>
                      {(line) => (
                        <text fg={theme.text.base} wrapMode="none">
                          {line}
                        </text>
                      )}
                    </For>
                  </Show>
                </scrollbox>
              </box>
              <text fg={theme.text.muted} wrapMode="word">
                {table().footnote}
              </text>
            </>
          )
        }}
      </Show>
    </box>
  )
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default Plugin.define({
  id: "model-price-intel.tui",
  async setup(context) {
    const pricing = context.client.rpc(ModelPricing)
    const [table, setTable] = createSignal<PricingTable | undefined>()
    let open = false
    // Ignore a response that belongs to a dialog the user already closed.
    let request = 0

    const close = () => {
      request++
      open = false
      setTable(undefined)
    }

    const toggle = async () => {
      if (open) {
        open = false
        request++
        setTable(undefined)
        context.ui.dialog.clear()
        return
      }

      let location
      try {
        location = context.location ?? context.data.location.default()
      } catch (error) {
        context.ui.toast.show({
          title: "Model pricing",
          message: message(error),
          variant: "error",
        })
        return
      }

      open = true
      const id = ++request
      setTable(undefined)

      try {
        context.ui.dialog.show(
          () => <PricingDialog table={table} onClose={close} />,
          close,
        )
        // `show` starts a fresh dialog at the default size, so apply the larger
        // presentation afterwards.
        context.ui.dialog.set({ size: "xlarge", centered: true })

        const result = (await pricing.table({}, { location })) as PricingTable
        if (!open || id !== request) return
        setTable(result)
      } catch (error) {
        if (!open || id !== request) return
        close()
        context.ui.dialog.clear()
        context.ui.toast.show({
          title: "Model pricing",
          message: message(error),
          variant: "error",
        })
      }
    }

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "model-price-intel.prices",
          title: "Model pricing",
          group: "Model price intel",
          slash: { name: "model-pricing", aliases: ["prices"] },
          run: toggle,
        },
      ],
    }))
  },
})
