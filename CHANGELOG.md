# Changelog

All notable changes to `opencode-model-price-intel` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- `/model-pricing` and `/prices` now open a native TUI dialog with an aligned,
  scrollable table. The dialog closes with Escape, Ctrl+C, or a click outside.
  The RPC returns structured rows plus pre-rendered text, so the TUI can lay
  the table out for the current terminal width while other clients still get a
  readable fallback. Previously the server command injected a synthetic
  session message, which was delivered to the model instead of displayed.

## [1.0.0] - 2026-11-07

First public release.

### Changed

- A `0.0.0-stage` stub was published first only to reserve the npm name. It is
  untagged and not what `opencode plugin add opencode-model-price-intel`
  installs; `latest` points at `1.0.0`.

### Added

- `/model-pricing` command (alias `/prices`) that prints the full per-model
  pricing and Artificial Analysis Intelligence Index table.
- Per-model `/models` decoration with input/output/cache prices and the
  Intelligence Index score, including multi-tier pricing labels.
- Live Artificial Analysis fetch with a bundled v5.0 snapshot fallback,
  version/date provenance, and an explicit "AA n/a" state for unscored models.
- Plugin storage cache with a validated payload shape and periodic refresh.
- CI matrix on Node 20, 22, 24, and 26 with `npm ci`, typecheck, unit tests,
  `npm pack --dry-run`, and a packed-install smoke job.
- MIT `LICENSE` (2026), `NOTICE` for Artificial Analysis attribution,
  `CHANGELOG.md`, `RELEASE.md`, fixture provenance, and package metadata
  (`repository`, `author`, `homepage`, `bugs`, `publishConfig`, `keywords`).
- Pinned `@opencode/plugin@2.2.5`, committed `package-lock.json`, and
  `engines.node >= 20`.

### Fixed

- `/model-pricing` and `/prices` now read the `ModelListOutput.data` envelope
  instead of iterating the response object.
- Model transforms and commands are registered before network/storage work;
  the first render uses snapshot/cache data and refreshes in the background.
- Invalid `refreshHours` values fall back to a safe finite interval, refresh
  ticks cannot overlap, and cleanup clears the timer and aborts in-flight work.
- Storage/cache failures and corrupt cache payloads no longer prevent the
  plugin from loading or decorating models.
- Artificial Analysis fetching uses the Free API endpoint, validates response
  shape/pagination, keeps per-source abort budgets, and preserves snapshot
  capture dates/versions.
- Pricing output corrects context-tier labels, preserves published precision,
  handles free/paid detection, and resolves remaining `lookupScore`/variant
  ambiguities.
- Package release hygiene: exact dependency pin, lockfile, strict typecheck
  config, LICENSE, CI, audit documentation, and fixture provenance.
- README refresh/caching, install, multi-tier, and attribution claims are
  aligned with the actual behavior.

### Security

- `npm audit --omit=dev` reports 24 moderate advisories in the transitive
  `@opencode/plugin@2.2.5` install tree (publishing/sigstore/glob/minimatch
  paths). They are documented as host-provided runtime risk in `RELEASE.md`
  and are **not** claimed as fixed.
