import { describe, expect, it } from 'vitest';
import { groupQueries } from './grouper';
import { mergeCommercialSynonyms } from './synonyms';
import type { GscRawRow } from '../types';

function row(query: string, impressions: number, clicks = 0, url = 'https://a.co/x/'): GscRawRow {
  return {
    url,
    query,
    clicks,
    impressions,
    ctr: 0,
    avgPosition: 10,
    startDate: '',
    endDate: '',
    pulledAt: '',
  };
}

describe('mergeCommercialSynonyms', () => {
  it('merges support/services variants of the same phrase into one group', () => {
    const groups = groupQueries([
      row('it support sheffield', 500, 10),
      row('it services sheffield', 200, 5),
      row('sheffield it support', 100),
    ]);
    expect(groups).toHaveLength(2); // strict grouping keeps services separate
    const merged = mergeCommercialSynonyms(groups);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.canonicalQuery).toBe('it support sheffield');
    expect(merged[0]!.totalImpressions).toBe(800);
    expect(merged[0]!.variantCount).toBe(3);
    expect(merged[0]!.groupingRationale).toContain('commercial synonyms');
  });

  it('merges company/firm/agency provider-style modifiers', () => {
    const merged = mergeCommercialSynonyms(
      groupQueries([row('cyber security company', 300), row('cyber security firm', 100), row('cyber security agency', 50)]),
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]!.canonicalQuery).toBe('cyber security company');
  });

  it('never merges across locations or distinct topics', () => {
    const merged = mergeCommercialSynonyms(
      groupQueries([
        row('it support sheffield', 300),
        row('it support birmingham', 200),
        row('technology businesses sheffield', 100),
      ]),
    );
    expect(merged).toHaveLength(3);
  });

  it('keeps groups on different URLs separate', () => {
    const merged = mergeCommercialSynonyms([
      ...groupQueries([row('it support sheffield', 300, 0, 'https://a.co/one/')]),
      ...groupQueries([row('it services sheffield', 200, 0, 'https://a.co/two/')]),
    ]);
    expect(merged).toHaveLength(2);
  });

  it('leaves single unrelated groups untouched', () => {
    const groups = groupQueries([row('penetration testing', 100)]);
    expect(mergeCommercialSynonyms(groups)).toEqual(groups);
  });
});
