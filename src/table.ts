import { lookupScore, type AAFetched } from "./aa.ts"
import { formatCost, type CostTier } from "./pricing.ts"

export interface TableModel {
  readonly id: string
  readonly modelID?: string
  readonly providerID: string
  readonly name: string
  readonly cost: readonly CostTier[] | undefined
}

export function modelKey(model: TableModel): string {
  return `${model.providerID}/${model.modelID || model.id}`
}

export function markdownCell(value: unknown): string {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r\n|\r|\n/g, " ")
}

export function buildTable(
  models: readonly TableModel[],
  aa: AAFetched,
  baseNames: ReadonlyMap<string, string>,
  decorateNames: boolean,
): string {
  const lines: string[] = [
    "### Model pricing & Artificial Analysis Intelligence Index",
    "",
    `Prices per 1M tokens from the live OpenCode model registry. Scores: Artificial Analysis Intelligence Index v${markdownCell(aa.version)}, source ${markdownCell(aa.source)}, fetched ${markdownCell(aa.fetchedAt.slice(0, 10))}. Attribution: https://artificialanalysis.ai/`,
    "",
    "| Model | Provider | Tier | Input | Output | Cache read | Cache write | AA Intelligence |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ]

  for (const model of models) {
    const baseName = decorateNames
      ? (baseNames.get(modelKey(model)) ?? model.name)
      : model.name
    const score = lookupScore(aa.scores, model.id, baseName)
    const aaCell =
      score?.score != null
        ? `${Math.round(score.score * 10) / 10}${score.note ? ` (${score.note})` : ""}`
        : "n/a"

    let tiers: ReturnType<typeof formatCost> = []
    try {
      tiers = formatCost(model.cost)
    } catch (error) {
      console.warn(`[model-pricing] could not format cost for ${modelKey(model)}:`, error)
    }
    const rows = tiers.length > 0 ? tiers : [undefined]
    rows.forEach((tier, index) => {
      const cells = [
        index === 0 ? baseName : "",
        index === 0 ? model.providerID : "",
        tier ? (tier.tierLabel ?? (index === 0 ? "base" : "")) : "base",
        tier ? tier.input : "n/a",
        tier ? tier.output : "n/a",
        tier ? tier.cacheRead : "n/a",
        tier ? tier.cacheWrite : "n/a",
        index === 0 ? aaCell : "",
      ]
      lines.push(`| ${cells.map(markdownCell).join(" | ")} |`)
    })
  }

  return lines.join("\n")
}

/** Remove our own decoration if a transform is replayed against a stale name. */
export function undecoratedName(name: string, price: string): string {
  const suffix = ` · ${price} · AA `
  const index = name.lastIndexOf(suffix)
  if (index < 0) return name
  const tail = name.slice(index + suffix.length)
  if (tail !== "n/a" && !/^-?\d+(?:\.\d+)?$/.test(tail)) return name
  return name.slice(0, index)
}
