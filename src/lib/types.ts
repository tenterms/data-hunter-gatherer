/**
 * Shared types for the SEO reporting tool.
 *
 * Naming convention: rows read from Google Sheets keep their sheet column
 * names (snake_case) so the mapping between the admin sheet and the code is
 * obvious to non-technical readers of both.
 */

// ---------------------------------------------------------------------------
// Google Sheets admin config rows
// ---------------------------------------------------------------------------

export interface ClientRow {
  client_key: string;
  client_name: string;
  domain: string;
  gsc_property_url: string;
  timezone: string;
  active: boolean;
  notes: string;
}

export type PeriodStatus = "pending" | "ready" | "generated" | "archived";

export interface ReportPeriodRow {
  period_key: string;
  client_key: string;
  label: string;
  start_date: string; // YYYY-MM-DD
  end_date: string;
  comparison_start_date: string;
  comparison_end_date: string;
  status: PeriodStatus;
}

export type PageRole = "primary" | "secondary" | "supporting" | "rest_of_site";
export type ContentType = "commercial" | "blog" | "guide" | "sector" | "tool" | "other";
export type CommercialPriority = "high" | "medium" | "low";

export interface ClientPageRow {
  client_key: string;
  url: string;
  label: string;
  page_role: PageRole;
  content_type: ContentType;
  commercial_priority: CommercialPriority;
  active: boolean;
  notes: string;
}

export interface ContentGroupRow {
  client_key: string;
  group_key: string;
  group_name: string;
  description: string;
  active: boolean;
}

export type UrlMatchType = "exact" | "contains" | "starts_with" | "not_contains";

export interface ContentGroupUrlRow {
  client_key: string;
  group_key: string;
  url: string;
  match_type: UrlMatchType;
  active: boolean;
}

export interface TopicClusterRow {
  client_key: string;
  topic_key: string;
  topic_name: string;
  description: string;
  active: boolean;
}

export type QueryMatchType = "contains" | "exact" | "regex" | "not_contains";

export interface TopicClusterRuleRow {
  client_key: string;
  topic_key: string;
  match_type: QueryMatchType;
  query_text: string;
  case_sensitive: boolean;
  active: boolean;
}

export type DrawTiming = "completed_this_month" | "planned_next_month";
export type DrawCategory = "design_dev" | "reactive_seo" | "anything_else" | "writing";

export interface DrawTaskRow {
  client_key: string;
  period_key: string;
  timing: DrawTiming;
  category: DrawCategory;
  title: string;
  description: string;
  status: string;
}

export interface RankingKeywordRow {
  client_key: string;
  keyword: string;
  market: string;
  location: string;
  device: string;
  target_url: string;
  priority: string;
  active: boolean;
}

export interface RankingImportRow {
  client_key: string;
  period_key: string;
  keyword: string;
  start_position: number | null;
  end_position: number | null;
  search_engine: string;
  location: string;
  device: string;
  target_url: string;
  search_volume: number | null;
  ranking_url: string;
  visibility_score: number | null;
}

export interface AiSearchPromptRow {
  client_key: string;
  prompt_key: string;
  prompt: string;
  engine: string;
  market: string;
  expected_brand: string;
  expected_url: string;
  priority: string;
  active: boolean;
}

export interface NarrativeOverrideRow {
  client_key: string;
  period_key: string;
  section: string;
  suggested_text: string;
  override_text: string;
  final_text: string;
  approved_by: string;
  approved_at: string;
}

export interface StrategicNoteRow {
  client_key: string;
  period_key: string;
  note_type: string;
  title: string;
  body: string;
  priority: string;
  active: boolean;
}

/** Per-client display config for SE Ranking search engines (order + visibility). */
export interface RankingEngineRow {
  client_key: string;
  engine_id: string;
  label: string;
  sort_order: number | null;
  active: boolean;
}

/** Cannibalisation queries the team has chosen to hide from the report. */
export interface CannibalisationExclusionRow {
  client_key: string;
  query: string;
}

/**
 * Account manager notes for a client/month: the priorities, client concerns
 * and work-in-progress that should steer the report's commentary.
 */
export interface FocusNoteRow {
  client_key: string;
  period_key: string;
  notes: string;
}

export interface GeneratedReportRow {
  client_key: string;
  period_key: string;
  generated_at: string;
  snapshot_path: string;
  dashboard_url: string;
  status: string;
}

/** Everything the report generator needs for one client, resolved from Sheets or mock data. */
export interface AdminConfig {
  clients: ClientRow[];
  reportPeriods: ReportPeriodRow[];
  clientPages: ClientPageRow[];
  contentGroups: ContentGroupRow[];
  contentGroupUrls: ContentGroupUrlRow[];
  topicClusters: TopicClusterRow[];
  topicClusterRules: TopicClusterRuleRow[];
  drawTasks: DrawTaskRow[];
  rankingKeywords: RankingKeywordRow[];
  rankingImports: RankingImportRow[];
  aiSearchPrompts: AiSearchPromptRow[];
  narrativeOverrides: NarrativeOverrideRow[];
  strategicNotes: StrategicNoteRow[];
  rankingEngines: RankingEngineRow[];
  cannibalisationExclusions: CannibalisationExclusionRow[];
  focusNotes: FocusNoteRow[];
}

// ---------------------------------------------------------------------------
// GSC data
// ---------------------------------------------------------------------------

/** A row as returned by the Search Console searchanalytics API (or the mock). */
export interface GscRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface DateRange {
  startDate: string;
  endDate: string;
}

export interface GscDataset {
  summary: GscRow | null; // no dimensions — whole-property totals
  pages: GscRow[]; // dimensions: [page]
  queries: GscRow[]; // dimensions: [query]
  queryPages: GscRow[]; // dimensions: [query, page]
}

// ---------------------------------------------------------------------------
// Calculated metrics
// ---------------------------------------------------------------------------

export interface MetricSet {
  clicks: number;
  impressions: number;
  /** clicks / impressions; 0 when impressions are 0 */
  ctr: number;
  /** impression-weighted average position; null when there are no impressions */
  position: number | null;
}

export interface Comparison {
  current: number;
  previous: number;
  change: number;
  /**
   * Percentage change. null when previous is 0 and current > 0 ("new") so the
   * raw JSON never contains Infinity/NaN.
   */
  changePct: number | null;
  isNew: boolean;
}

export interface ComparedMetrics {
  clicks: Comparison;
  impressions: Comparison;
  ctr: Comparison;
  /** current/previous of null means "no data for that side" */
  position: {
    current: number | null;
    previous: number | null;
    change: number | null; // negative = improved (moved towards position 1)
  };
}

export type GrowthStatus = "growing" | "decaying" | "flat";
export type GrowthMetric = "clicks" | "impressions";

export interface GroupPerformance {
  key: string;
  name: string;
  description: string;
  current: MetricSet;
  previous: MetricSet;
  comparison: ComparedMetrics;
  status: GrowthStatus;
  /** number of GSC rows that matched this group/cluster in the current period */
  matchedRowCount: number;
}

export interface PagePerformance {
  url: string;
  label: string;
  pageRole: PageRole;
  contentType: ContentType;
  commercialPriority: CommercialPriority;
  current: MetricSet;
  previous: MetricSet;
  comparison: ComparedMetrics;
}

export interface CannibalisationPageBreakdown {
  url: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
  pageRole: PageRole | null;
  commercialPriority: CommercialPriority | null;
}

export type PriorityFlag = "high" | "medium" | "low";

export interface CannibalisationIssue {
  query: string;
  /** curated out by the team (hidden from the client view) */
  hidden?: boolean;
  pageCount: number;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
  pages: CannibalisationPageBreakdown[];
  priorityScore: number;
  priorityFlag: PriorityFlag;
}

// ---------------------------------------------------------------------------
// Rankings
// ---------------------------------------------------------------------------

export type MovementDirection = "up" | "down" | "flat" | "entered" | "dropped";

export interface RankingMovement {
  keyword: string;
  startPosition: number | null;
  endPosition: number | null;
  /** positive = places gained (moved towards 1); null for entered/dropped */
  change: number | null;
  direction: MovementDirection;
  searchVolume: number | null;
  targetUrl: string;
  rankingUrl: string;
  /** SE Ranking keyword group name, when the provider supplies one */
  groupName?: string | null;
}

/** One search engine's tracked-keyword performance (SE Ranking supports several per project). */
export interface RankingEngineData {
  id: string;
  label: string;
  /** hidden from the report by the team (admin panel toggle) */
  hidden?: boolean;
  summary: RankingSummary;
}

/** Tracked-keyword movements grouped by the client's topic clusters. */
export interface KeywordClusterPerformance {
  key: string;
  name: string;
  tracked: number;
  up: number;
  down: number;
  entered: number;
  dropped: number;
  flat: number;
  averagePosition: { start: number | null; end: number | null };
  /** biggest single mover in the cluster, for the report table */
  bestMove: RankingMovement | null;
}

export interface RankingSummary {
  keywordsTracked: number;
  positionsUp: number;
  positionsDown: number;
  entered: number;
  dropped: number;
  top3: { current: number; previous: number };
  top10: { current: number; previous: number };
  top30: { current: number; previous: number };
  averagePosition: { current: number | null; previous: number | null };
  /** provider-supplied score if available, otherwise null */
  visibilityScore: number | null;
  notableGains: RankingMovement[];
  notableDeclines: RankingMovement[];
  movements: RankingMovement[];
  source: "se_ranking_api" | "sheet_import" | "csv_import" | "mock" | "unavailable";
}

// ---------------------------------------------------------------------------
// Findings & commentary
// ---------------------------------------------------------------------------

export type FindingSentiment = "positive" | "negative" | "neutral" | "warning";

export interface Finding {
  id: string;
  sentiment: FindingSentiment;
  /** short machine-usable tag, e.g. "clicks_up", "cannibalisation_high_priority" */
  kind: string;
  /** plain-English statement of the fact — deterministic, produced in code */
  text: string;
  /** supporting numbers, kept so the LLM can quote real figures only */
  data?: Record<string, string | number | null>;
}

export interface Findings {
  executive_findings: Finding[];
  traffic_findings: Finding[];
  content_group_findings: Finding[];
  topic_cluster_findings: Finding[];
  cannibalisation_findings: Finding[];
  ranking_findings: Finding[];
  strategic_priority_candidates: Finding[];
}

export type CommentaryMode = "rules_only" | "llm_draft" | "human_override";

export type CommentarySection =
  | "executive_summary"
  | "traffic"
  | "content_groups"
  | "topic_clusters"
  | "cannibalisation"
  | "rankings"
  | "strategic_priorities";

export interface SectionCommentary {
  section: CommentarySection;
  /** what the rules engine or LLM drafted */
  suggestedText: string;
  /** where suggestedText came from */
  suggestedSource: "rules_only" | "llm_draft";
  /** human override from the NarrativeOverrides sheet, if any */
  overrideText: string | null;
  /** overrideText when present, otherwise suggestedText */
  finalText: string;
  mode: CommentaryMode;
}

// ---------------------------------------------------------------------------
// KPIs & the report snapshot
// ---------------------------------------------------------------------------

export interface KpiCardData {
  key: string;
  label: string;
  value: string;
  changeLabel: string | null;
  sentiment: FindingSentiment;
}

export interface PublishState {
  token: string;
  publishedAt: string;
}

export interface ReportSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  dataSource: "mock" | "live";
  /** set when a frozen copy of this report has been shared with the client */
  published?: PublishState | null;
  client: ClientRow;
  period: ReportPeriodRow;
  kpis: KpiCardData[];
  metrics: {
    site: { current: MetricSet; previous: MetricSet; comparison: ComparedMetrics };
    pages: PagePerformance[];
    restOfSite: { current: MetricSet; previous: MetricSet; comparison: ComparedMetrics; pageCount: number };
    contentGroups: GroupPerformance[];
    topicClusters: GroupPerformance[];
    cannibalisation: CannibalisationIssue[];
    rankings: RankingSummary;
    /** topical performance (by tracked keyword); absent in pre-v2 snapshots */
    keywordClusters?: KeywordClusterPerformance[];
    /** where keywordClusters came from: SE Ranking's own groups, or the topic cluster rules */
    keywordClustersSource?: "se_ranking_groups" | "topic_clusters";
    /** per-search-engine rankings (SE Ranking); absent when only one source exists */
    rankingEngines?: RankingEngineData[];
  };
  findings: Findings;
  commentary: SectionCommentary[];
  drawTasks: DrawTaskRow[];
  strategicNotes: StrategicNoteRow[];
  /** account manager's focus notes for the month (steers commentary drafts) */
  focusNotes?: string | null;
  /**
   * Raw-ish inputs, kept so the report is reproducible even if later API pulls
   * would return different numbers.
   */
  raw: {
    gsc: { current: GscDataset; comparison: GscDataset };
    rankingImports: RankingImportRow[];
    rankingKeywords: RankingKeywordRow[];
  };
  /** future placeholders — not populated in V1 */
  future: {
    conversions: null;
    ga4: null;
    aiSearch: { prompts: AiSearchPromptRow[]; results: null };
  };
}
