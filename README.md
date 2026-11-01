# opencode-model-pricing

OpenCode plugin that makes the `/models` list show **input, output and cache
prices per model** together with each model's **Artificial Analysis
Intelligence Index score** (when available).

```
/models
  GPT 6 Astra · in $10 out $50 · cache read $1 write $12.5 · AA 56.9
  Kimi K3 · in $3 out $15 · cache read $0.3 write $3 · AA n/a
  Big Pickle · free · AA n/a
```

Prices are listed **per model, per 1M tokens**, including the cache read and
cache write prices. `/model-pricing` (alias `/prices`) prints the complete
table — every context-price tier, all four price columns, and the AA score —
into the session.

## Data is fetched automatically before each session

This information changes over time (price drops, promotional discounts, new
benchmark evaluations), so nothing important is baked in at build time:

| Data | Source | When it refreshes |
| --- | --- | --- |
| Input / output / cache prices | Live OpenCode model registry (`Model.Info.cost`, refreshed by OpenCode from the provider catalogs — the same values published at <https://opencode.ai/v2/docs/console/models#pricing>) | Every time OpenCode loads the plugin, i.e. **before a coding session starts** |
| Artificial Analysis Intelligence Index | <https://artificialanalysis.ai/> — the official free Data API when an API key is configured, otherwise the public model pages | Before every session, cached in plugin storage, and re-fetched periodically while the session is open (default every 12 h) |

If the Artificial Analysis fetch fails (offline, rate limited), the plugin
falls back to a cached copy, then to a bundled snapshot captured 2026-10-31
(Intelligence Index v5.0). Scores are shown rounded to one decimal; models
without a published score show `AA n/a`.

## How it shows up in `/models`

The built-in `/models` picker is a host dialog that plugins cannot add columns
to; it renders each model's registry entry, with `Model.Info.name` as the row
title. The plugin therefore attaches a compact pricing + score line to the
display name via a model transform — so `/models` lists the prices and the AA
score for every model. Set `"decorateNames": false` to disable this and keep
only the `/model-pricing` command.

## Install

Local plugin directory (auto-loads from `.opencode/plugins/`), or reference it
from `opencode.json(c)`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "/path/to/opencode-model-pricing",
    {
      "package": "/path/to/opencode-model-pricing",
      "options": {
        "decorateNames": true,
        "costFormat": "compact",
        "aaApiKey": "{env:ARTIFICIALANALYSIS_API_KEY}",
        "refreshHours": 12,
      },
    },
  ],
}
```

### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `decorateNames` | `true` | Attach the pricing/score line to model names in `/models` |
| `costFormat` | `"detailed"` | Cost line format: `detailed` (`in $10 out $50 · cache read $1 write $12.5`) or `compact` (`$10/$50/$1/$12.5` = `<in>/<out>/<read>/<write>` — keeps rows readable on narrow screens such as mobile web sessions) |
| `scroll` | `false` | Turn rows wider than the available space into scrolling marquee text (the model name stays pinned; the detail slides and wraps) |
| `scrollWidth` | `40` | Maximum row width in characters. Acts as a **ceiling**: clients that report their viewport (terminals do automatically, see below) narrow the rows further, down to what they actually have |
| `scrollIntervalMs` | `500` | Marquee tick interval |
| `scrollStep` | `3` | Characters advanced per tick (3 per 500 ms ≈ 6 chars/s) |
| `scrollBurstMs` | `6000` | How long each scroll burst lasts |
| `scrollPauseMs` | `20000` | Rest between bursts. The rows are static during the rest — no repaints — so client lists keep their scroll position while you browse. `0` scrolls continuously |
| `aaApiKey` | – | Artificial Analysis Data API key (else `ARTIFICIALANALYSIS_API_KEY`, else public pages) |
| `refreshHours` | `12` | Score cache TTL and in-session refresh interval |

### Dynamic row width

Scrolling rows are sized to the real available space, not a fixed guess:

- **Terminal sessions** — the bundled TUI part reports its terminal width to the
  server automatically (and re-reports on resize) over the plugin's `viewport`
  RPC. Rows re-flow live when you resize.
- **Anything else** (web clients, scripts) — the same RPC is exposed over HTTP
  as `POST /api/rpc/model-pricing/viewport` with body
  `{"input": {"client": "my-phone", "width": 32}}`; it returns the effective
  width. The stock OpenCode web app does not report its viewport yet, so for
  web-only sessions set `scrollWidth` to your screen's row width (as a ceiling
  for everyone).
- Width reports expire after 5 minutes, so a closed narrow terminal does not
  keep rows short forever.

### Scrolling vs. client scroll position (web UI)

Each marquee repaint is a model-list data update. The terminal UI handles that
fine, but the stock **web UI resets a list's vertical scroll position when its
data refreshes** — so server-driven scrolling and a stable scroll position are
mutually exclusive there, and plugins cannot change the web UI's rendering.

To get continuous scrolling **and** a stable scroll position in the web UI,
install the companion browser script in `extras/web-scroll-keeper.ts`
(bookmarklet form included in its header): it restores your scroll position
whenever a re-render resets it to the top. With it installed, set
`"scrollPauseMs": 0` for continuous scrolling.

## Commands

| Command | Effect |
| --- | --- |
| `/model-pricing` | Full pricing + Intelligence Index table for every listed model |
| `/prices` | Alias of `/model-pricing` |

## Notes

- Prices are per 1M tokens and cover every context-price tier the model
  publishes (`≤272K` / `>272K` style tiers each get a row in the table).
- Intelligence Index scores are versioned (currently v5.0) and are **not
  comparable across major versions**; the version is shown with the table.
- Attribution: score data by [Artificial Analysis](https://artificialanalysis.ai/).
  Their API terms require attribution when sharing derived data.

## Development

```sh
node --test test/   # unit tests + live fetch smoke test (skips when offline)
```

`src/aa.ts` contains the Artificial Analysis fetcher/normalizer, `src/pricing.ts`
the price formatting, `src/index.ts` the plugin wiring.
