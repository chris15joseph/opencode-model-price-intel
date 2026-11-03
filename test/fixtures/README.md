# Test fixture provenance

These fixtures are repository-only test inputs. They are excluded from the npm
package by the `files` allowlist in `package.json`.

## `aa-payload.txt`

| Field | Value |
| --- | --- |
| Source | https://artificialanalysis.ai/models |
| Content | Captured Next.js RSC payload (`self.__next_f.push`) from the public model list page |
| Captured | 2026-10-31 |
| Captured for | `test/model-pricing.test.ts` parser tests |
| Third-party data | Artificial Analysis Intelligence Index (v5.0) |
| Attribution / terms | https://artificialanalysis.ai/ and https://artificialanalysis.ai/terms |

## `aa-company-aggregates.txt`

| Field | Value |
| --- | --- |
| Source | https://artificialanalysis.ai/ model/evaluations payload (company aggregate rows) |
| Content | Company aggregate records (Google, Anthropic, OpenAI, Meta, Kimi, …) that must never be treated as models |
| Captured | 2026-11-02 |
| Captured for | `test/model-pricing.test.ts` company-row filtering tests |
| Third-party data | Artificial Analysis Intelligence Index (v5.0) |
| Attribution / terms | https://artificialanalysis.ai/ and https://artificialanalysis.ai/terms |

Both fixtures are public benchmark/model data only. They contain no API keys,
account data, or other secrets. Do not add captured responses that include
credentials or private account information.

### Re-capturing

1. Open https://artificialanalysis.ai/models in a browser.
2. Save the page source (or the relevant `self.__next_f.push` RSC chunks) as
   `test/fixtures/aa-payload.txt`.
3. Run `npm test`; parser expectations may need updating if Artificial
   Analysis changes its page structure or index version.
4. Record the new capture date in this file and in `src/aa-snapshot.ts` if the
   bundled fallback is regenerated.
