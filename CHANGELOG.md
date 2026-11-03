# Changelog

All notable changes to `opencode-model-pricing` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - Unreleased

Initial public release. This entry stays **Unreleased** until the checklist in
`RELEASE.md` is complete. Publishing requires explicit approval.

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
