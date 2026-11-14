# Artificial Analysis snapshot — provenance and attribution

`src/aa-snapshot.ts` is a bundled fallback copy of the Artificial Analysis
Intelligence Index. It is used as the full fallback when both live sources
fail. When live data is available, snapshot entries fill gaps only when the
live index version exactly matches the snapshot's version.

| Field | Value |
| --- | --- |
| Index | Artificial Analysis Intelligence Index |
| Version | 5.0.1 (major.minor.patch; patch releases can change scores) |
| Captured | 2026-11-14 |
| Primary source | <https://artificialanalysis.ai/leaderboards/models> |
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
  `deepseek-v4-pro -> deepseekv4pro0813`,
  `muse-wonder-1.0 -> musewonder`, and
  `nemotron-3-ultra -> nemotron3ultra550ba55b`.
- Scores are only comparable within the same **index version**. Live results
  from a different version (including a patch release such as v5.0.1) are not
  merged with this snapshot.
- `snapshotScores().fetchedAt` is the capture date above, never the current
  time. Snapshot-derived entries carry a `[snapshot]` note.
- Coverage (live vs snapshot numeric scores) is returned as
  `AAFetched.coverage` and logged by `fetchAAScores`.

## Regeneration

```sh
# Full list via the Free API (preferred; requires a valid key)
ARTIFICIALANALYSIS_API_KEY=... node scripts/regenerate-snapshot.ts

# Fallback from the public leaderboard page (no key)
node scripts/regenerate-snapshot.ts --from-page
```

The script rewrites `src/aa-snapshot.ts`, refreshes existing entries from the
current index version, keeps documented aliases whose targets still exist, and
refuses to overwrite the snapshot when the live source returns no records.
Previously scored entries that the current version no longer scores become
`null` rather than carrying a stale number. Review the diff and run `npm test`
before committing.

## Test fixtures

`test/fixtures/aa-payload.txt` contains records captured from the AA
model-list page (2026-10-31) for parser regression tests.
`test/fixtures/aa-company-aggregates.txt` reproduces the company aggregate rows
from the evaluations page that must never be treated as models.
