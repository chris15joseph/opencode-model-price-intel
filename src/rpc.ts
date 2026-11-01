import { Rpc } from "@opencode/plugin/rpc"

/**
 * RPC contract between the plugin's parts and external clients.
 *
 * `viewport` lets a client report the width it has available for model rows so
 * the server can size scrolling rows to the actual space instead of a fixed
 * guess. The TUI part reports automatically (POST /api/rpc/model-pricing/viewport
 * under the hood); anything else — web clients, scripts — may call the same
 * endpoint over HTTP.
 */
export const ModelPricingRpc = Rpc.define({
  id: "model-pricing",
  methods: {
    viewport: {
      input: {
        type: "object",
        properties: {
          client: { type: "string" },
          width: { type: "integer", minimum: 10 },
          height: { type: "integer" },
        },
        required: ["width"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { width: { type: "integer" } },
        required: ["width"],
        additionalProperties: false,
      },
    },
  },
  events: {},
})
