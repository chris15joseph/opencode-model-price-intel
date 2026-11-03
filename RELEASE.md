# Release checklist — `opencode-model-pricing`

**Status: not published.** Publishing requires explicit approval from the
repository owner (Christopher Joseph). CI in this repository never publishes;
there is no publish workflow and no npm token configured.

## Supported runtime

- OpenCode 2.2.5 (`@opencode/plugin` pinned to exactly `2.2.5`).
- Node.js `>=20` for development, tests, and CI. CI runs Node 20, 22, 24, and
  26.
- The package entry is raw TypeScript (`exports["."] = "./src/index.ts"`). The
  OpenCode 2.2.x plugin host transpiles it. Plain Node cannot import the
  installed package from `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`);
  Bun and the OpenCode host can. The CI smoke job imports a copy of the
  installed payload outside `node_modules` to validate the module graph.

## Versioning and tags

- Follow SemVer: `MAJOR.MINOR.PATCH`.
- `1.0.0` is the first release and is still **Unreleased**.
- Tag releases as annotated tags: `vX.Y.Z` (for example `v1.0.0`).
- The tag must match `package.json` `version` exactly. Never move or re-point a
  published tag.
- Tag only after the full checklist below passes on the commit being released.
- Do not tag or publish from a dirty working tree.

## Bundled snapshot provenance and regeneration

`src/aa-snapshot.ts` is a bundled fallback copy of the Artificial Analysis
Intelligence Index. It is used only when both live sources fail, and only when
the live index version has the same major version. `NOTICE` is the shipped
attribution notice; this section documents the snapshot rules for maintainers.

| Field | Value |
| --- | --- |
| Index | Artificial Analysis Intelligence Index |
| Version | 5.0 (major.minor; patch releases are not part of the version) |
| Captured | 2026-10-31 |
| Primary source | <https://artificialanalysis.ai/models> |
| Free API endpoint | <https://artificialanalysis.ai/api/v2/language/models/free> |
| Attribution | <https://artificialanalysis.ai/> |

Artificial Analysis requires attribution when API/page data is displayed. The
plugin shows the source URL in the `/model-pricing` command table; the plugin
README carries the same attribution.

### Snapshot rules

- Canonical keys are `matchKey(name)` values (lowercase alphanumerics, with
  parenthesized effort qualifiers and the OpenCode `Free` tier marker removed).
- OpenCode catalog IDs whose digit order differs from the AA display name are
  listed in `AA_SNAPSHOT_ALIASES` in `src/aa-snapshot.ts`:
  `claude-haiku-4-5 -> claude45haiku`, `claude-sonnet-4-5 -> claude45sonnet`,
  and `muse-wonder-1.0 -> musewonder`.
- Scores are only comparable within the same **major** index version. Live v6
  results are not merged with this v5 snapshot.
- `snapshotScores().fetchedAt` is the capture date above, never the current
  time. Snapshot-derived entries carry a `[snapshot]` note.
- Coverage (live vs snapshot numeric scores) is returned as
  `AAFetched.coverage` and logged by `fetchAAScores`.

### Regeneration

```sh
# Full list via the Free API (preferred; requires a valid key)
ARTIFICIALANALYSIS_API_KEY=... node scripts/regenerate-snapshot.ts

# Partial fallback from the public model-list page (no key; retains old entries)
node scripts/regenerate-snapshot.ts --from-page
```

The script rewrites `src/aa-snapshot.ts`, preserves existing notes for entries
whose AA name is unchanged, keeps documented aliases whose targets still exist,
and refuses to overwrite the snapshot when the live source returns no records.
Review the diff and run `node --test test/` before committing. Do not commit a
snapshot whose version is a new major release without updating the README's
version note.

### Test fixtures

`test/fixtures/aa-payload.txt` contains records captured from the AA
model-list page (2026-10-31) for parser regression tests.
`test/fixtures/aa-company-aggregates.txt` reproduces the company aggregate rows
from the evaluations page that must never be treated as models. Fixtures are
not included in the npm package; see `test/fixtures/README.md` for capture
details and re-capture steps.

## Release checklist

### Pre-release gates

- [ ] Working tree clean (`git status --short` empty) and the release commit is
      on `master`.
- [ ] `npm ci` succeeds from the committed `package-lock.json`.
- [ ] `npm run typecheck` exits 0. Do not release while it fails.
- [ ] `npm test` passes on Node 20, 22, 24, and 26.
- [ ] CI matrix is green, including the `pack + install smoke` job.
- [ ] `npm pack --dry-run` contains only `package.json`, `README.md`,
      `LICENSE`, `NOTICE`, and `src/`. Tests, fixtures, lockfiles, and archives
      must not be shipped.
- [ ] `npm audit --omit=dev` has been re-run and the result is recorded below.
- [ ] `CHANGELOG.md` has an entry for the version and the date is set when
      released (it stays `Unreleased` until then).
- [ ] README claims match code and live behavior (owned by WS6).
- [ ] No secrets, `node_modules/`, `*.tgz`, or coverage output are tracked.
- [ ] Explicit publish approval has been recorded by the repository owner.

### Tag and publish (manual, after approval)

1. Update `CHANGELOG.md`: replace `Unreleased` with the release date.
2. Commit the release notes.
3. Create the annotated tag:
   `git tag -a vX.Y.Z -m "vX.Y.Z"`
4. Run the full gate once more on the tagged commit.
5. Publish only with explicit approval:
   `npm publish --access public`
   `prepublishOnly` runs `npm run typecheck && npm test`, so a failing gate
   blocks the publish.
6. Push the tag and create the GitHub release from `CHANGELOG.md`.
7. Never publish from CI or from an unapproved local shell.

## Dependency audit (2026-11-02)

Command: `npm audit --omit=dev` (also `npm audit` for the full tree).

```text
24 moderate severity vulnerabilities
0 high, 0 critical, 0 low, 0 info
```

The install tree is 273 packages (about 201 MB on disk) because
`@opencode/plugin@2.2.5` pulls `@opencode/client`, `@opencode/schema`,
`@opencode/util`, `effect`, and, through `@opencode/util`, the npm
publishing/sigstore stack (`pacote`, `sigstore`, `tuf-js`, `@tufjs/models`,
`make-fetch-happen`, `cacache`, `glob`, `minimatch`, `npm-packlist`, and
related packages). The advisories are transitive and moderate (denial of
service / glob/minimatch and sigstore/TUF paths); most report "no fix
available" under the pinned 2.2.5 tree.

**These advisories are not fixed by this change.** They are documented as a
host-provided runtime risk: the plugin uses only `Plugin.define` from
`@opencode/plugin`, and the actual OpenCode host provides the plugin runtime.
The dependency is exact-pinned and the lockfile makes the tree reproducible.
`npm audit fix` was not run because it would change the pinned tree without a
compatibility test. Re-run `npm audit --omit=dev` at every release and revisit
when a newer `@opencode/plugin` release updates the transitive stack.

## Cross-repo duplication decision (2026-11-02)

The small cache/TTL/fetch/interval helpers stay **duplicated** between
`opencode-model-pricing` and `opencode-zero-retention-models` for 1.0.0.

Rationale:

- The duplicated surface is small (cache freshness check, storage get/set,
  fetch fallback, interval setup and cleanup).
- The two plugins have different failure semantics (per-source AA degradation
  vs. policy-page completeness), so premature unification would either leak
  one plugin's policy into the other or add options the other does not need.
- A shared package would add a third versioned artifact, another publish/tag
  path, and another supply-chain surface for a few dozen lines.
- Revisit extraction only if a **third** plugin appears, or if the helpers grow
  past roughly 100 lines or start to diverge in behavior. Until then, keep the
  implementations side-by-side and review both repositories together.

## Shared cross-repo review checklist

Use this for every change to either plugin:

- [ ] `package.json`: exact `@opencode/plugin` pin (`2.2.5`),
      `engines.node >= 20`, `repository`, `author`, `homepage`, `bugs`,
      `publishConfig.access = public`, and a `files` allowlist.
- [ ] `package-lock.json` committed; CI uses `npm ci`; no `node_modules/`,
      `*.tgz`, or coverage output tracked.
- [ ] `tsconfig.json`: `strict`, `noEmit`, `module`/`moduleResolution`
      `NodeNext`, `allowImportingTsExtensions`, `types: ["node"]`,
      `skipLibCheck`; includes `src` and `test`.
- [ ] Scripts: `typecheck` (`tsc --noEmit`), `test` (`node --test test/`), and
      `prepublishOnly` (`npm run typecheck && npm test`).
- [ ] CI: Node 20/22/24/26 matrix, `npm ci`, typecheck, tests,
      `npm pack --dry-run`, and a packed-install smoke job. **No publish job.**
- [ ] `LICENSE` (MIT, 2026), `CHANGELOG.md`, this `RELEASE.md`, and fixture
      provenance under `test/fixtures/README.md`.
- [ ] `NOTICE` for third-party data where required (Artificial Analysis in
      `opencode-model-pricing`).
- [ ] `npm audit --omit=dev` recorded; advisories documented, never silently
      claimed as fixed.
- [ ] Tarball contains only `package.json`, `README.md`, `LICENSE`, intended
      `NOTICE`, and `src/`; tests/fixtures are excluded.
- [ ] README refresh/caching/install/attribution claims match behavior.
- [ ] Version, changelog, and `vX.Y.Z` tag agree; publish approval recorded.
