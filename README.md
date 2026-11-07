# opencode-model-price-intel

[![CI](https://github.com/chris15joseph/opencode-model-price-intel/actions/workflows/ci.yml/badge.svg)](https://github.com/chris15joseph/opencode-model-price-intel/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/opencode-model-price-intel)](LICENSE)

An OpenCode 2 plugin that puts **prices and the Artificial Analysis
Intelligence Index** next to every model in `/models`, and adds a full
`/model-pricing` table when you need the details.

```text
/models
  GPT 6 Astra · in $2.5 out $15 · cache read $0.25 write $0 (2 tiers) · AA 56.9
  Kimi K3 · in $3 out $15 · cache read $0.3 write $3 · AA n/a
  Big Pickle · free · AA n/a
```

Prices are USD per 1M tokens, read from the live OpenCode model registry. Scores
come from Artificial Analysis and refresh in the background. Both are cached, so
the first `/models` render is instant and the network never blocks it.

## Install

Requires OpenCode 2.2.x (the plugin pins `@opencode/plugin` to `2.2.5`) and
Node.js 20 or newer.

> **npm status:** the package is staged but not yet published. Until it appears
> on npm, install from Git:
>
> ```sh
> opencode plugin add github:chris15joseph/opencode-model-price-intel
> ```

```sh
opencode plugin add opencode-model-price-intel
```

Or add it to `opencode.json(c)` yourself:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-model-price-intel"]
}
```

Local checkout:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/absolute/path/to/opencode-model-price-intel"]
}
```

A plugin directory under `.opencode/plugins/` also loads automatically. Do not
list the same plugin twice.

### Options

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "opencode-model-price-intel",
      "options": {
        "decorateNames": true,
        "costFormat": "compact",
        "aaApiKey": "{env:ARTIFICIALANALYSIS_API_KEY}",
        "refreshHours": 12
      }
    }
  ]
}
```

| Option | Default | Meaning |
| --- | --- | --- |
| `decorateNames` | `true` | Append the price/score summary to `/models` names. The details still show up on reload and via `/model-pricing`. |
| `costFormat` | `"detailed"` | `"detailed"` renders `in $2.5 out $15 · cache read $0.25 write $0`; `"compact"` renders `$2.5/$15/$0.25/$0`. |
| `aaApiKey` | unset | Artificial Analysis API key. Falls back to `ARTIFICIALANALYSIS_API_KEY`. Without either, the public model-list page is used. |
| `refreshHours` | `12` | Score cache TTL and refresh interval, clamped to `1..596` hours. |

Invalid option values log one warning and fall back to the defaults.

## Commands

| Command | What it does |
| --- | --- |
| `/model-pricing` | Prints a Markdown table with every model, provider, price tier, cache price, and AA score. |
| `/prices` | Alias of `/model-pricing`. |
| `/models` | The native picker, now decorated with the one-line summary. |

The table is a synthetic session message; no model call is made. Multi-tier
models get one row per price entry (`base`, then `>N` for context overrides).

## How it works

- Prices come from `Model.Info.cost` in the live OpenCode registry. The plugin
  does not bundle a price table and does not convert currencies.
- Scores are fetched from the Artificial Analysis Free Data API when a key is
  configured, otherwise from the public model-list page.
- A bundled v5.0 snapshot (captured 2026-10-31) is registered before any
  network or storage work, so the first render is immediate. It is only merged
  with live data from the same **major** index version.
- The last good result is cached in OpenCode plugin storage for `refreshHours`.
  A cache older than 30 days is ignored.
- The model registry reloads only when the score data actually changes.
- Unscored models show `AA n/a`. A model with no registry cost shows
  `pricing n/a` (or `n/a` in compact mode).

## Limitations

- The built-in picker has no plugin column API, so the summary is appended to
  the model **name**. Set `decorateNames: false` to leave names untouched.
- Prices are catalog prices, not your invoice. Providers can add surcharges,
  discounts, or regional pricing that the registry does not carry.
- AA scores are comparative within one index major version. The plugin never
  mixes a v5 snapshot into a v6 result.
- The plugin only decorates the list and prints a table. It does not route
  requests or change model selection.

## Development

Requires Node.js 20 or newer.

```sh
npm ci
npm run typecheck
npm test
npm pack --dry-run
```

The package exports raw TypeScript (`src/index.ts`); OpenCode 2.2.x transpiles
it at load. Plain Node cannot import the installed package from `node_modules`.

## Attribution

Scores and related model data are produced by
[Artificial Analysis](https://artificialanalysis.ai/). The `/model-pricing`
header carries the source, index version, capture/fetch date, and attribution
link. See [`NOTICE`](NOTICE) and [`SNAPSHOT-NOTICE.md`](SNAPSHOT-NOTICE.md) for
provenance.

## License

MIT. See [LICENSE](LICENSE).
