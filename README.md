# opencode-model-pricing

OpenCode plugin that makes the built-in `/models` list show each model's
**input, output, cache read and cache write prices** together with its
**Artificial Analysis Intelligence Index score** when one is available. It also
adds `/model-pricing` (alias `/prices`), which prints the full per-tier table
into the session.

```text
/models
  GPT 6 Astra · in $2.5 out $15 · cache read $0.25 write $0 (2 tiers) · AA 56.9
  Kimi K3 · in $3 out $15 · cache read $0.3 write $3 · AA n/a
  Big Pickle · free · AA n/a
```

Prices are USD per 1M tokens from the live OpenCode model registry. The
`/models` line is a compact summary; `/model-pricing` is the full detail and
attribution surface.

## What you get

### `/models` decoration

The built-in `/models` picker is a host dialog that plugins cannot add columns
to, so the plugin appends a summary to `Model.Info.name`:

```text
<model name> · <prices> · AA <score>
```

- `costFormat: "detailed"` (default) renders
  `in $2.5 out $15 · cache read $0.25 write $0`.
- `costFormat: "compact"` renders `$2.5/$15/$0.25/$0`
  (`<input>/<output>/<cache read>/<cache write>`).
- A model with more than one price entry gets an `(N tiers)` marker. `N` is the
  number of price entries (the base entry plus any context overrides), so a
  base price plus one override is `(2 tiers)`. The marker does not list the
  individual thresholds; use `/model-pricing` for those.
- Models with no published score show `AA n/a`.
- Models with no registry cost show `pricing n/a` in the detailed format or
  `n/a` in the compact format.
- Set `decorateNames: false` to leave model names untouched. Both commands are
  still registered and the background refresh still runs for the command table.

### `/model-pricing` and `/prices`

Both command names execute the same handler and append a **synthetic session
message** (no model call). The message is a Markdown table with these columns:

| Column | Meaning |
| --- | --- |
| `Model` | Base model name, without the `/models` decoration |
| `Provider` | Provider ID, for example `opencode` or `opencode-go` |
| `Tier` | `base` for an untiered price entry; `>N` for a context-tier override |
| `Input` | USD per 1M input tokens |
| `Output` | USD per 1M output tokens |
| `Cache read` | USD per 1M cache-read tokens |
| `Cache write` | USD per 1M cache-write tokens |
| `AA Intelligence` | Rounded Intelligence Index score, or `n/a` |

The table prints one row per price entry. A context-tier row is labeled with the
threshold it applies above, for example `>32K`; the untiered base row is
labeled `base`. Continuation rows leave `Model`, `Provider` and
`AA Intelligence` blank so the model is not repeated.

The header above the table records the index version actually in use, the
source, the fetch/capture date, and the Artificial Analysis attribution URL.
A scored AA cell can include a source note, for example a variant label, or
`[snapshot]` when a live result was filled from the bundled snapshot.

Both commands work in OpenCode 2.2.5; the repository's wiring tests exercise
both names with the real `ctx.model.list()` envelope.

## Prices

- Prices come from the **live OpenCode model registry** (`Model.Info.cost`),
  which OpenCode refreshes from provider catalogs. This plugin does not bundle
  a price table and does not convert currencies.
- Every price value is **USD per 1M tokens**.
- An entry with `tier.type === "context"` applies **above** that context size,
  not up to it. A `>32K` row therefore means the listed prices apply when the
  context exceeds 32K tokens. An untiered base entry has no `>N` label.
- `usd()` preserves the published precision instead of rounding to four
  decimals: `0.003625` renders as `$0.003625`, and `10` renders as `$10`.
- A positive price below `$0.00005` renders explicitly as `<$0.00005`. A
  negative or non-finite value renders as `?`.
- `free` is used only when **every** price entry has input, output, cache read
  and cache write at zero. A model with a non-zero cache price is shown with
  its prices, not as free.

## Artificial Analysis scores and data sources

Scores are fetched in this order:

| Source | When it is used |
| --- | --- |
| Free-tier Data API: <https://artificialanalysis.ai/api/v2/language/models/free> | When `aaApiKey` is set, or when `ARTIFICIALANALYSIS_API_KEY` is present in the environment |
| Public model-list page: <https://artificialanalysis.ai/models> | When no API key is configured, or when the API key request fails or returns no usable model records |
| Bundled snapshot (not fetched) | Registered for the first render; same-major gap-fill when live data omits a model; last resort when live sources fail and no cache is usable |

The bundled snapshot is **Artificial Analysis Intelligence Index v5.0**,
captured **2026-10-31** from the public model list. It is not a live result:

- It is registered immediately at plugin load so the first `/models` render
  does not wait for the network.
- When a live result arrives, snapshot entries only fill models that the live
  source did not score, and only when the live index has the **same major
  version** (v5). Snapshot-filled entries carry a `[snapshot]` note.
- If both live sources fail, the last valid plugin cache is kept. With no
  usable cache, the bundled snapshot remains in use.
- Scores are **not comparable across major index versions**. A v5 snapshot is
  never merged into a v6 result, and the table prints the version actually in
  use.

Scores are displayed rounded to one decimal. Models without a published score
show `AA n/a` in `/models` and `n/a` in the command table. When a live fetch
succeeds, the plugin logs the live-versus-snapshot coverage counts.

### Attribution

Scores and related model data are produced by
[Artificial Analysis](https://artificialanalysis.ai/). Attribution is required
when displaying derived data:

- The `/models` decoration is a derived summary rendered as plain text in a
  host dialog, so it carries no URL.
- `/model-pricing` is the attribution and detail surface: its header includes
  the source, version, fetched/capture date, and
  `Attribution: https://artificialanalysis.ai/`.
- The published package ships a `NOTICE` file with the same attribution and
  the snapshot provenance. Do not remove it when redistributing the package.

See `NOTICE` for the shipped attribution and provenance summary, and
`RELEASE.md` for the snapshot rules, alias list, and regeneration commands.
`RELEASE.md` is a repository document, not part of the npm tarball.

## Refresh and cache

The plugin fetches Artificial Analysis data on plugin load subject to the cache
TTL (**12 h** by default, the same as `refreshHours`), and refreshes every
`refreshHours` (default **12 h**, clamped to **1..596 h**) while OpenCode is
running. When the network is unavailable it falls back to the last valid cache,
or to the bundled snapshot when no cache is usable.

Details:

- The model transform and both commands are registered before any storage or
  network work. The first render uses the bundled snapshot immediately.
- On load, a cache entry younger than `refreshHours` is adopted without a
  network request. A cache entry older than `refreshHours` but within 30 days
  is adopted while a live fetch is attempted; if that fetch fails, that cache
  remains. Entries with a future timestamp, an invalid shape, or an age above
  30 days are ignored.
- The refresh timer fires every `refreshHours`. A refresh that is still in
  flight is not overlapped by the next tick, and cleanup clears the timer and
  aborts in-flight work.
- The model registry is reloaded only when the adopted score data actually
  changes. With `decorateNames: false`, no model reload is attempted.
- The cache is stored in OpenCode plugin storage. It contains the score map,
  index version, source, and fetch timestamp.

## Install

Requirements:

- OpenCode 2.2.5. The plugin pins `@opencode/plugin` to exactly `2.2.5`.
- Node.js `>= 20` (declared in `engines`; development and CI use Node 20, 22,
  24 and 26).
- The package exports raw TypeScript (`exports["."] = "./src/index.ts"`); the
  OpenCode 2.2.5 plugin host transpiles it. It is not a prebuilt JavaScript
  bundle, and plain Node cannot import the installed package from
  `node_modules` as-is.

Pick **exactly one** of the forms below for this plugin. The object form is an
alternative to a string entry, not an additional entry.

### npm package form

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-model-pricing@1.0.0"]
}
```

The `1.0.0` package is prepared but not yet published. Until it is published,
use one of the local forms below.

### Local path form

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/absolute/path/to/opencode-model-pricing"]
}
```

A directory placed under `.opencode/plugins/` also auto-loads. If you use that
mechanism, do not also list the same plugin in `plugins`.

### Object form with options

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "/absolute/path/to/opencode-model-pricing",
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

`package` accepts the same values as the string form: an npm package name, a
local directory, or a `file://` URL.

## Options

All options are optional. Invalid values produce one
`[model-pricing] invalid options — ...` warning when the plugin is set up, then
fall back to the listed safe default.

| Option | Type | Default | Behavior |
| --- | --- | --- | --- |
| `decorateNames` | boolean | `true` | Append the price/score summary to `/models` names. A non-boolean value falls back to `true`. |
| `costFormat` | `"detailed"` or `"compact"` | `"detailed"` | Format of the `/models` cost line. `compact` is `<input>/<output>/<cache read>/<cache write>`. The command table always has separate columns. An invalid value falls back to `"detailed"`. |
| `aaApiKey` | string | unset | Artificial Analysis API key. If omitted or empty, the plugin reads `ARTIFICIALANALYSIS_API_KEY`. Without either, it uses the public model-list page. A non-string value is ignored with a warning, and the environment fallback still applies. |
| `refreshHours` | finite number | `12` | Cache freshness window and refresh interval, in hours. Finite values are clamped to `1..596`; non-finite, non-numeric, zero, or negative values fall back to `12`. |

## Development

```sh
npm ci
npm run typecheck   # tsc --noEmit
npm test            # node --test test/
npm pack --dry-run
```

CI runs `npm ci`, typecheck, unit tests, and `npm pack --dry-run` on Node 20,
22, 24 and 26, plus a pack/install smoke job on Node 22. The smoke job checks
the tarball contents, imports the packaged plugin, and, when `opencode` is
available, loads it in a temporary OpenCode configuration.

`npm pack` ships only `package.json`, `README.md`, `LICENSE`, `NOTICE`, and
`src/`. Tests, fixtures, scripts, `CHANGELOG.md`, and `RELEASE.md` are not
included in the tarball.

## Notes

- The experimental scrolling (marquee) mode for narrow screens was removed.
  Its periodic name repaints made client model lists reset their vertical
  scroll position in both the TUI and the web UI. Names are static.
- Score matching is intentionally strict about sibling models: an exact match
  wins, and ambiguous siblings produce `AA n/a` rather than a borrowed score.
- The plugin does not call a model to build the pricing table; `/model-pricing`
  and `/prices` append a synthetic session message.
- License: MIT. See `LICENSE`. Artificial Analysis attribution and snapshot
  provenance are in `NOTICE`.
