/** RPC contract shared by the server plugin and the TUI part. */

import { Rpc } from "@opencode/plugin/rpc"

/** One aligned table row; continuation tiers leave model/provider/aa blank. */
export interface PricingRow {
  readonly model: string
  readonly provider: string
  readonly tier: string
  readonly input: string
  readonly output: string
  readonly cache: string
  readonly aa: string
}

export const ModelPricing = Rpc.define({
  id: "model-price-intel",
  methods: {
    table: {
      input: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          /** Pre-rendered fallback table (also useful to copy for support). */
          text: { type: "string" },
          title: { type: "string" },
          meta: { type: "string" },
          footnote: { type: "string" },
          rows: {
            type: "array",
            items: {
              type: "object",
              properties: {
                model: { type: "string" },
                provider: { type: "string" },
                tier: { type: "string" },
                input: { type: "string" },
                output: { type: "string" },
                cache: { type: "string" },
                aa: { type: "string" },
              },
              required: ["model", "provider", "tier", "input", "output", "cache", "aa"],
              additionalProperties: false,
            },
          },
        },
        required: ["text", "title", "meta", "footnote", "rows"],
        additionalProperties: false,
      },
    },
  },
  events: {},
})

export interface PricingTable {
  readonly text: string
  readonly title: string
  readonly meta: string
  readonly footnote: string
  readonly rows: readonly PricingRow[]
}
