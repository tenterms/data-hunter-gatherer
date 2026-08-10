import type { QueryGroup, QueryVariant } from '../types';
import { pickCanonical } from './grouper';

/**
 * Commercial-synonym merge pass.
 *
 * The base grouper is deliberately strict: only near-identical variants share
 * a group. In practice the team treats direct commercial synonyms as one
 * opportunity — "it support sheffield" and "it services sheffield" get woven
 * into the same H2 — so this pass runs after grouping and merges groups whose
 * signatures differ ONLY by tokens from the same commercial synonym set.
 * Everything else (locations, industries, distinct services) still keeps
 * groups apart.
 */
const SYNONYM_SETS: string[][] = [
  ['support', 'service', 'services'],
  ['company', 'companies', 'firm', 'firms', 'agency', 'agencies', 'provider', 'providers', 'supplier', 'suppliers', 'specialist', 'specialists', 'consultancy'],
  ['cost', 'costs', 'price', 'prices', 'pricing', 'fee', 'fees'],
];

const CANONICAL_TOKEN = new Map<string, string>();
for (const set of SYNONYM_SETS) {
  for (const token of set) CANONICAL_TOKEN.set(token, set[0]!);
}

/** Signature with each commercial synonym replaced by its set's canonical token. */
function synonymSignature(signature: string): string {
  const [tokens, ...rest] = signature.split('::');
  const mapped = tokens!
    .split('|')
    .map((t) => CANONICAL_TOKEN.get(t) ?? t)
    .sort()
    .join('|');
  return [mapped, ...rest].join('::');
}

export function mergeCommercialSynonyms(groups: QueryGroup[]): QueryGroup[] {
  const byKey = new Map<string, QueryGroup[]>();
  for (const group of groups) {
    // Groups split apart by an explicit rule are never re-merged.
    const key = group.signature.includes('::split::')
      ? `${group.url}##${group.signature}`
      : `${group.url}##${synonymSignature(group.signature)}`;
    const list = byKey.get(key) ?? [];
    list.push(group);
    byKey.set(key, list);
  }

  const merged: QueryGroup[] = [];
  for (const list of byKey.values()) {
    if (list.length === 1) {
      merged.push(list[0]!);
      continue;
    }
    const variants: QueryVariant[] = list.flatMap((g) => g.variants);
    const totalClicks = variants.reduce((a, v) => a + v.clicks, 0);
    const totalImpressions = variants.reduce((a, v) => a + v.impressions, 0);
    const weightedAvgPosition =
      totalImpressions > 0
        ? Math.round((variants.reduce((a, v) => a + v.avgPosition * v.impressions, 0) / totalImpressions) * 100) / 100
        : list[0]!.weightedAvgPosition;
    const best = [...variants].sort((a, b) => a.avgPosition - b.avgPosition)[0]!;
    const highest = [...variants].sort((a, b) => b.impressions - a.impressions)[0]!;
    // The dominant group's signature stands for the merged row.
    const dominant = [...list].sort((a, b) => b.totalImpressions - a.totalImpressions)[0]!;
    merged.push({
      url: dominant.url,
      signature: dominant.signature,
      canonicalQuery: pickCanonical(variants),
      variants: [...variants].sort((a, b) => b.impressions - a.impressions),
      totalClicks,
      totalImpressions,
      weightedAvgPosition,
      bestQuery: best.query,
      highestImpressionQuery: highest.query,
      variantCount: variants.length,
      groupingRationale: `Grouped ${list.length} commercial synonyms (${list
        .map((g) => `"${g.canonicalQuery}"`)
        .join(', ')}) — the team targets these together.`,
    });
  }
  merged.sort((a, b) => b.totalImpressions - a.totalImpressions);
  return merged;
}
