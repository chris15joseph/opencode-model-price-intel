# Artificial Analysis snapshot — provenance and attribution

`src/aa-snapshot.ts` is a bundled fallback copy of the Artificial Analysis
Intelligence Index. It is used only when both live sources fail, and only when
the live index version has the same major version.

| Field | Value |
| --- | --- |
| Index | Artificial Analysis Intelligence Index |
| Version | 5.0 (major.minor; patch releases are not part of the version) |
| Captured | 2026-10-31 |
| Primary source | <https://artificialanalysis.ai/models> |
| Free API endpoint | <https://artificialanalysis.ai/api/v2/language/models/free> |
| Attribution | <https://artificialanalysis.ai/> |

Artificial Analysis requires attribution when API/page data is displayed. The
`/model-pricing` panel header carries the source URL and index version; the
plugin README, `NOTICE`, and this file carry the same attribution.

## Snapshot rules

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

## Regeneration

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

## Test fixtures

`test/fixtures/aa-payload.txt` contains records captured from the AA
model-list page (2026-10-31) for parser regression tests.
`test/fixtures/aa-company-aggregates.txt` reproduces the company aggregate rows
from the evaluations page that must never be treated as models.
