/**
 * Bundled snapshot of the Artificial Analysis Intelligence Index (v5.0).
 *
 * FALLBACK ONLY. The plugin fetches fresh scores from artificialanalysis.ai
 * every time OpenCode loads it (scores change as new evaluations land).
 * This snapshot (captured 2026-10-31) is used when the live fetch fails.
 *
 * Keys are normalized via aa.ts `matchKey` (parenthesized qualifiers such as
 * "(Max)" are stripped and punctuation removed). Generated from the same
 * parser the live fetch uses.
 *
 * Source: https://artificialanalysis.ai/ (Intelligence Index v5.0).
 * Attribution required by Artificial Analysis terms.
 */

export interface AAScore {
  /** Intelligence Index score, or null when not scored in v5.0. */
  score: number | null
  /** Name of the exact AA entry matched (includes effort variant). */
  name: string
  /** Caveats, e.g. effort variant or historical v4.x scores. */
  note?: string
}

export const AA_INDEX_VERSION = "5.0"

export const AA_SNAPSHOT: Readonly<Record<string, AAScore>> = {
  "beam10": {
    score: 17.7307282547205,
    name: "Beam 1.0",
  },
  "beamreflectionbeam": {
    score: 17.7,
    name: "Beam (Reflection Beam)",
    note: "v5.0 score; AA entry name: Beam 1.0. AA slug 'reflection-beam', display name 'Beam 1.0'.",
  },
  "bigpickle": {
    score: null,
    name: "Big Pickle",
    note: "No Artificial Analysis Intelligence Index score found (v5.0 or earlier). Stealth model (per OpenCode docs); not listed on Artificial Analysis; no score found.",
  },
  "claudefable5": {
    score: null,
    name: "Claude Fable 5",
    note: "Not scored in v5.0. v4.2 score 53.2 (llmcompare snapshot 2026-10-12); v4.1: 59.9 (with Opus 4.8 fallback).",
  },
  "claudefable51": {
    score: 49.0102124158081,
    name: "Claude Fable 5.1 (Max, Default Fallback)",
    note: "AA variant: (max, default fallback)",
  },
  "claudehaiku45": {
    score: null,
    name: "Claude 4.5 Haiku",
    note: "Not scored in v5.0. v4.2 score 22.5 (llmcompare snapshot 2026-10-12).",
  },
  "claudehaiku55": {
    score: 36.2345435880142,
    name: "Claude Haiku 5.5 (Max)",
  },
  "claudeopus45": {
    score: null,
    name: "Claude Opus 4.5",
    note: "Not scored in v5.0. v4.1 score 34.7.",
  },
  "claudeopus46": {
    score: null,
    name: "Claude Opus 4.6",
    note: "Not scored in v5.0. v4.1 score 37.8 (v4.0-era: 53 max).",
  },
  "claudeopus47": {
    score: null,
    name: "Claude Opus 4.7",
    note: "Not scored in v5.0. v4.1 score 53.5; v4.0: 57.3.",
  },
  "claudeopus48": {
    score: null,
    name: "Claude Opus 4.8",
    note: "Not scored in v5.0. v4.2 score 42.0 (llmcompare snapshot 2026-10-12); v4.1: 55.7 (max); v4.0: 61.4.",
  },
  "claudeopus5": {
    score: null,
    name: "Claude Opus 5",
    note: "Not scored in v5.0. v4.2 score 54.1 (llmcompare snapshot 2026-10-12).",
  },
  "claudeopus55": {
    score: 58.4060336078904,
    name: "Claude Opus 5.5 (Max, Default Fallback)",
    note: "AA variant: (max, default fallback)",
  },
  "claudesonnet45": {
    score: null,
    name: "Claude 4.5 Sonnet",
    note: "Not scored in v5.0. v4.0-era score 43 (Reasoning, per AA Sonnet 4.6 article, Feb 2026).",
  },
  "claudesonnet46": {
    score: null,
    name: "Claude Sonnet 4.6",
    note: "Not scored in v5.0. v4.2 score 30.5 (llmcompare snapshot 2026-10-12); v4.1: 35.9.",
  },
  "claudesonnet5": {
    score: null,
    name: "Claude Sonnet 5",
    note: "Not scored in v5.0. v4.2 score 45.1 (llmcompare snapshot 2026-10-12).",
  },
  "claudesonnet55": {
    score: 54.24133407109,
    name: "Claude Sonnet 5.5 (Max, Default Fallback)",
    note: "AA variant: (max, default fallback)",
  },
  "deepseekv41flash": {
    score: null,
    name: "DeepSeek V4.1 Flash",
    note: "Base snapshot not scored in v5.0; v5.0 scores DeepSeek V4.1 Flash 1017 (Max) at 32.5. v4.2: 39.5 (llmcompare snapshot 2026-10-12).",
  },
  "deepseekv41flash1017": {
    score: 32.4896393532027,
    name: "DeepSeek V4.1 Flash 1017 (Max)",
  },
  "deepseekv4pro": {
    score: 23.1,
    name: "DeepSeek V4 Pro",
    note: "v5.0 score; AA entry name: DeepSeek V4 Pro 0813 (Max).",
  },
  "flint40b": {
    score: null,
    name: "Flint 40B",
    note: "No Artificial Analysis Intelligence Index score found (v5.0 or earlier). Not listed on Artificial Analysis; no score found.",
  },
  "gemini31pro": {
    score: null,
    name: "Gemini 3.1 Pro",
    note: "Not scored in v5.0. v4.2 score 36.7 (llmcompare snapshot 2026-10-12); v4.1: 46.5 (Preview).",
  },
  "gemini35flash": {
    score: null,
    name: "Gemini 3.5 Flash",
    note: "Not scored in v5.0. v4.2 score 39.7 (llmcompare snapshot 2026-10-12); v4.1: 50.2 (high).",
  },
  "gemini35flashlite": {
    score: 11.7,
    name: "Gemini 3.5 Flash-Lite",
    note: "v5.0 score; AA entry name: Gemini 3.5 Flash-Lite.",
  },
  "gemini36flash": {
    score: null,
    name: "Gemini 3.6 Flash",
    note: "Not scored in v5.0. v4.2 score 40.3 (llmcompare snapshot 2026-10-12).",
  },
  "gemini37flash": {
    score: null,
    name: "Gemini 3.7 Flash",
    note: "Not scored in v5.0. v4.2 score 45.2 (llmcompare snapshot 2026-10-12).",
  },
  "gemini38flash": {
    score: 30.5468119957291,
    name: "Gemini 3.8 Flash (High)",
    note: "AA variant: (high)",
  },
  "gemini3flash": {
    score: null,
    name: "Gemini 3 Flash",
    note: "Not scored in v5.0. v4.1 score 37.8 (Preview, Reasoning).",
  },
  "gemini4argon": {
    score: 50.4,
    name: "Gemini 4 Argon",
    note: "v5.0 score; AA entry name: Gemini 4 Argon (High).",
  },
  "gemini4carbon": {
    score: 59.425738829526,
    name: "Gemini 4 Carbon (High)",
    note: "AA variant: (high)",
  },
  "glm5": {
    score: null,
    name: "GLM 5",
    note: "Not scored in v5.0. v4.1 score 39.5 (v4.0-era: 50).",
  },
  "glm51": {
    score: null,
    name: "GLM 5.1",
    note: "Not scored in v5.0. v4.2 score 26.4 (llmcompare snapshot 2026-10-12); v4.1: 40.2.",
  },
  "glm52": {
    score: null,
    name: "GLM 5.2",
    note: "Not scored in v5.0. v4.2 score 34.0 (llmcompare snapshot 2026-10-12).",
  },
  "glm53": {
    score: 31.653381843882,
    name: "GLM-5.3 (Max)",
  },
  "glm53flash": {
    score: 27.8,
    name: "GLM 5.3 Flash",
    note: "v5.0 score; AA entry name: GLM-5.3-Flash.",
  },
  "gpt5": {
    score: null,
    name: "GPT-5",
    note: "Not scored in v5.0. v4.1 score 36.1.",
  },
  "gpt51": {
    score: null,
    name: "GPT-5.1",
    note: "Not scored in v5.0. v4.1 score 38.9.",
  },
  "gpt52": {
    score: null,
    name: "GPT-5.2",
    note: "Not scored in v5.0. v4.1 score 42.2 (xhigh); v4.0-era report: 51.",
  },
  "gpt53codex": {
    score: null,
    name: "GPT-5.3 Codex",
    note: "Not scored in v5.0. v4.1 score 44.3 (xhigh); v4.0-era report: 54.",
  },
  "gpt53codexspark": {
    score: null,
    name: "GPT-5.3 Codex Spark",
    note: "No Artificial Analysis Intelligence Index score found (v5.0 or earlier). Not listed on Artificial Analysis; no score found.",
  },
  "gpt54": {
    score: null,
    name: "GPT-5.4",
    note: "Not scored in v5.0. v4.1 score 51.4 (xhigh); v4.0-era report: 57 (tied with Gemini 3.1 Pro Preview).",
  },
  "gpt54mini": {
    score: null,
    name: "GPT-5.4 mini",
    note: "Not scored in v5.0. v4.2 score 24.6 (llmcompare snapshot 2026-10-12).",
  },
  "gpt54nano": {
    score: null,
    name: "GPT-5.4 nano",
    note: "Not scored in v5.0. v4.2 score 21.2 (llmcompare snapshot 2026-10-12).",
  },
  "gpt54pro": {
    score: null,
    name: "GPT-5.4 Pro",
    note: "No Artificial Analysis Intelligence Index score found (v5.0 or earlier). AA lists GPT-5.4 Pro (Xhigh) but has not scored it; no historical score found.",
  },
  "gpt55": {
    score: null,
    name: "GPT-5.5",
    note: "Not scored in v5.0. v4.2 score 38.6 (llmcompare snapshot 2026-10-12); v4.1: 54.8 (xhigh).",
  },
  "gpt55pro": {
    score: null,
    name: "GPT-5.5 Pro",
    note: "No Artificial Analysis Intelligence Index score found (v5.0 or earlier). AA lists GPT-5.5 Pro (Xhigh) but has never scored it; no historical score found.",
  },
  "gpt56luna": {
    score: null,
    name: "GPT-5.6 Luna",
    note: "Not scored in v5.0. v4.2 score 43.4 (llmcompare snapshot 2026-10-12).",
  },
  "gpt56sol": {
    score: null,
    name: "GPT-5.6 Sol",
    note: "Not scored in v5.0. v4.2 score 51.3 (llmcompare snapshot 2026-10-12).",
  },
  "gpt56terra": {
    score: null,
    name: "GPT-5.6 Terra",
    note: "Not scored in v5.0. v4.2 score 46.8 (llmcompare snapshot 2026-10-12).",
  },
  "gpt5nano": {
    score: null,
    name: "GPT-5 nano",
    note: "No Artificial Analysis Intelligence Index score found (v5.0 or earlier). AA lists GPT-5 nano but has not scored it; no historical score found.",
  },
  "gpt61sol": {
    score: 54.5087338138148,
    name: "GPT-6.1 Sol (Max)",
  },
  "gpt61terra": {
    score: 50.9765188577015,
    name: "GPT-6.1 Terra (Max)",
  },
  "gpt6astra": {
    score: 56.8538559596797,
    name: "GPT-6 Astra (Max)",
  },
  "gpt6luna": {
    score: 27.7552004938153,
    name: "GPT-6 Luna (Max)",
  },
  "gpt6sol": {
    score: null,
    name: "GPT-6 Sol",
    note: "No Artificial Analysis Intelligence Index score found (v5.0 or earlier). AA lists GPT-6 Sol (Max) but has not scored it in v5.0; no v4.x score found.",
  },
  "grok45": {
    score: null,
    name: "Grok 4.5",
    note: "Not scored in v5.0. v4.2 score 45.5 (llmcompare snapshot 2026-10-12).",
  },
  "grok46": {
    score: null,
    name: "Grok 4.6",
    note: "Not scored in v5.0. v4.2 score 50.6 (llmcompare snapshot 2026-10-12).",
  },
  "grok47": {
    score: 34.3350117067196,
    name: "Grok 4.7 (Xhigh)",
    note: "AA variant: (xhigh)",
  },
  "grokbuild01": {
    score: null,
    name: "Grok Build 0.1",
    note: "No Artificial Analysis Intelligence Index score found (v5.0 or earlier). AA lists Grok Build 0.1 0616 but has not scored it; no historical score found.",
  },
  "hy3": {
    score: null,
    name: "Hy3",
    note: "Not scored in v5.0. v4.2 score 25.8 (llmcompare snapshot 2026-10-12).",
  },
  "hy4preview": {
    score: null,
    name: "Hy4 preview",
    note: "No Artificial Analysis Intelligence Index score found (v5.0 or earlier). Not listed on Artificial Analysis; no score found.",
  },
  "icemancontributor": {
    score: null,
    name: "Iceman Contributor",
    note: "No Artificial Analysis Intelligence Index score found (v5.0 or earlier). Not listed on Artificial Analysis; no score found.",
  },
  "inkling": {
    score: 12.4781698715401,
    name: "Inkling (Xhigh)",
    note: "AA variant: (xhigh)",
  },
  "jev113": {
    score: null,
    name: "Jev 1.13",
    note: "No Artificial Analysis Intelligence Index score found (v5.0 or earlier). System One decision model (TypeSafe AI); not listed on Artificial Analysis; no score found.",
  },
  "k2horizon375ba23b": {
    score: 17.7702731734027,
    name: "K2 Horizon 375B A23B",
  },
  "kimik25": {
    score: null,
    name: "Kimi K2.5",
    note: "Not scored in v5.0. v4.1 score 38.1 (v4.0-era: 47 Reasoning).",
  },
  "kimik26": {
    score: null,
    name: "Kimi K2.6",
    note: "Not scored in v5.0. v4.2 score 27.5 (llmcompare snapshot 2026-10-12); v4.1: 42.8.",
  },
  "kimik27code": {
    score: null,
    name: "Kimi K2.7 Code",
    note: "Not scored in v5.0. v4.2 score 26.3 (llmcompare snapshot 2026-10-12).",
  },
  "kimik3": {
    score: null,
    name: "Kimi K3",
    note: "Not scored in v5.0 at max effort (only Kimi K3 (Low): 17.4). v4.2 score 50.2 (llmcompare snapshot 2026-10-12).",
  },
  "kimik31pro": {
    score: 46.0026236744189,
    name: "Kimi K3.1 Pro",
  },
  "ling31flash1019": {
    score: 29.470119369837,
    name: "Ling 3.1 Flash 1019",
  },
  "longcat20": {
    score: null,
    name: "LongCat-2.0",
    note: "Not scored in v5.0. v4.2 score 19.7 (llmcompare snapshot 2026-10-12).",
  },
  "mimov25": {
    score: null,
    name: "MiMo-V2.5",
    note: "Not scored in v5.0. v4.2 score 22.3 (llmcompare snapshot 2026-10-12).",
  },
  "mimov25pro": {
    score: null,
    name: "MiMo-V2.5-Pro",
    note: "Not scored in v5.0. v4.2 score 32.6 (llmcompare snapshot 2026-10-12); v4.1: 42.2.",
  },
  "mimov26flash": {
    score: 26.7,
    name: "MiMo-V2.6-Flash",
    note: "v5.0 score; AA entry name: MiMo-V2.6-Flash.",
  },
  "mimov26pro": {
    score: 29.8897833093321,
    name: "MiMo-V2.6-Pro",
  },
  "minimaxm25": {
    score: null,
    name: "MiniMax M2.5",
    note: "Not scored in v5.0. v4.0-era score 42 (per AA MiniMax M2.7 article, Mar 2026).",
  },
  "minimaxm27": {
    score: null,
    name: "MiniMax M2.7",
    note: "Not scored in v5.0. v4.2 score 23.2 (llmcompare snapshot 2026-10-12); v4.1: 38.1; v4.0-era: 50.",
  },
  "minimaxm3": {
    score: 18.7,
    name: "MiniMax M3",
    note: "v5.0 score; AA entry name: MiniMax-M3.",
  },
  "minimaxm31flash": {
    score: 28.9095214290458,
    name: "MiniMax-M3.1-Flash",
  },
  "mistrallarge4": {
    score: 26.0249946754784,
    name: "Mistral Large 4 (High)",
    note: "AA variant: (high)",
  },
  "musespark12": {
    score: null,
    name: "Muse Spark 1.2",
    note: "Not scored in v5.0. v4.2 score 46.8 (llmcompare snapshot 2026-10-12).",
  },
  "musespark13": {
    score: 36.4,
    name: "Muse Spark 1.3",
    note: "v5.0 score; AA entry name: Muse Spark 1.3 (Max).",
  },
  "musesparkopen": {
    score: 24.6815868992913,
    name: "Muse Spark Open (Xhigh)",
    note: "AA variant: (xhigh)",
  },
  "musewonder": {
    score: 43.3248225998431,
    name: "Muse Wonder (Max)",
  },
  "musewonder10": {
    score: 43.3,
    name: "Muse Wonder",
    note: "v5.0 score; AA entry name: Muse Wonder (Max).",
  },
  "musewonderfull": {
    score: 49.7272123627021,
    name: "Muse Wonder Full (Max)",
  },
  "nemotron35lightning": {
    score: 5.5,
    name: "Nemotron 3.5 Lightning",
    note: "v5.0 score; AA entry name: Nemotron 3.5 Lightning.",
  },
  "nemotron35supervl": {
    score: 13.6203422723141,
    name: "Nemotron 3.5 Super VL",
  },
  "nemotron3ultra": {
    score: 11.8,
    name: "Nemotron 3 Ultra",
    note: "v5.0 score; AA entry name: Nemotron 3 Ultra 550B A55B (Reasoning).",
  },
  "qwen35plus": {
    score: null,
    name: "Qwen3.5 Plus",
    note: "No Artificial Analysis Intelligence Index score found (v5.0 or earlier). No 'Qwen3.5 Plus' on AA. Nearest entries: Qwen3.5 122B A10B (Reasoning) (v4.1 score 32.3) and Qwen3.5 Omni Plus (unscored).",
  },
  "qwen36plus": {
    score: null,
    name: "Qwen3.6 Plus",
    note: "Not scored in v5.0. v4.1 score 39.6.",
  },
  "qwen37plus": {
    score: null,
    name: "Qwen3.7 Plus",
    note: "Not scored in v5.0. v4.2 score 25.8 (llmcompare snapshot 2026-10-12); v4.1: 39.0.",
  },
  "qwen3827b": {
    score: 20.1068756031705,
    name: "Qwen3.8 27B (Xhigh)",
    note: "AA variant: (xhigh)",
  },
  "qwen38flash": {
    score: null,
    name: "Qwen3.8 Flash",
    note: "Not scored in v5.0. v4.2 score 39.9 for Qwen3.8 Flash Next (llmcompare snapshot 2026-10-12). Matched to AA model 'Qwen3.8-Flash-Next' (nearest Flash-tier entry).",
  },
  "qwen38max": {
    score: 33.5545627367888,
    name: "Qwen3.8 Max (0902)",
    note: "AA variant: (0902)",
  },
  "step5preview": {
    score: 28.5283090216016,
    name: "Step 5 Preview",
  },
}
