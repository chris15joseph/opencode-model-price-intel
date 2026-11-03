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
| `aaApiKey` | – | Artificial Analysis Data API key (else `ARTIFICIALANALYSIS_API_KEY`, else public pages) |
| `refreshHours` | `12` | Score cache TTL and in-session refresh interval |

## Commands

| Command | Effect |
| --- | --- |
| `/model-pricing` | Full pricing + Intelligence Index table for every listed model |
| `/prices` | Alias of `/model-pricing` |

## Notes

- Prices are per 1M tokens and cover every context-price tier the model
  publishes (`≤272K` / `>272K` style tiers each get a row in the table).
- An experimental scrolling (marquee) mode for narrow screens was removed: its
  periodic name repaints made client model lists reset their vertical scroll
  position (both TUI and web UI). Names are therefore static.
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
