# SEO Reporting Dashboard

Internal tool for producing consistent monthly SEO reports. The team configures
each client **inside the app** (built-in config database; a Google Sheet backend
is optional), data comes from **Google Search Console** and **rank-tracking**
imports, all analysis is calculated **deterministically in code**, commentary is
suggested (rules-based by default, optionally polished by an LLM, always
editable by a human), and every report is frozen as a **JSON snapshot** —
editable in the team backend, publishable to a read-only client share link.

```
app config (built-in DB)    GSC API / mock          SE Ranking CSV import
        │                        │                          │
        └───────────► generate report (button/CLI) ◄────────┘
                                 │
             deterministic metrics + findings engine
                                 │
             commentary (rules │ LLM draft │ human override)
                                 │
              data/reports/{client}/{period}.json  (snapshot)
                                 │
                     Next.js dashboard (npm run dev)
```

## What it reports

Per client per month: executive KPI cards + summary · GSC traffic (site,
primary/secondary/supporting pages, rest of site) · content group performance
(URL groups, All/Growing/Decaying, clicks/impressions) · topic cluster
performance (query-rule groups) · cannibalisation catcher (multi-page queries,
priority-scored) · tracked-keyword rankings (ups/downs/entered/dropped, top
3/10/30, visibility, notable movers) · the DRAW work grid (completed/planned) ·
strategic priorities. Conversions/GA4 and AI-search visibility are **schema
placeholders only** in V1 (see "Deferred" below).

## Day-to-day use: the Admin page (no commands)

Once the app is running, everything the team does day-to-day happens at
**`/admin`** in the dashboard:

- **Add a new client** — name + website; the tool creates the client with a
  homepage entry and its first reporting month.
- **Key pages** — assign labels/roles to the client's real GSC pages (offered
  as one-click additions, sorted by impressions).
- **Content groups & topic clusters** — SEOGets-style editors: name +
  "contains" chips + "doesn't contain" chips, with a live list of the real
  GSC queries/pages that match as you type.
- **Work grid** — per-month editor for completed/planned DRAW tasks.
- **Add a reporting month** — pick a month; the comparison month is set
  automatically.
- **Upload a rankings CSV** — drop in an SE Ranking export for a month.
- **Generate / regenerate a report** — one button per month; view it instantly.
- **Edit commentary** — every section of the report page has an Edit button;
  edits are saved as overrides that survive regeneration (clear the box to
  revert to the suggestion).
- **Publish to a client link** — freezes the current report to an unguessable
  `/share/{token}` URL (read-only, no internals, noindex). Draft edits stay
  private until "Publish update" is clicked; "Unpublish" kills the link.

Team access: set `APP_PASSWORD` and the whole backend sits behind a shared
sign-in (30-day cookie); client share links stay public but unguessable.

Storage: the app keeps all configuration in its own database file
(`data/db/config.json`) — nothing to set up. Teams who want spreadsheet-style
bulk editing can set `CONFIG_BACKEND=sheets` to use a Google Sheet instead
(same columns; `npm run setup-sheet` creates the tabs). CLI commands below
exist for automation, not because anyone needs a terminal.

## Quick start (mock mode — no credentials needed)

```bash
npm install
npm test                     # 46 unit tests
npm run generate-all-reports # builds demo reports for two mock clients
npm run dev                  # dashboard at http://localhost:3000
```

With no Google credentials, GSC data is simulated deterministically (reports
are reproducible run-to-run) and the config database is seeded from the bundled
demo data on first edit. The dashboard labels every report **mock data** or
**live data** — and if the service account can't see a particular property,
that client's report falls back to simulated data instead of failing.

## Hosting (Railway)

The app saves files (config database, report snapshots, published client
copies), so it needs a host with a persistent volume — Railway's Hobby plan
works well. `railway.json` is included; deploy steps:

1. Sign up at railway.com with the GitHub account that can see this repo.
2. New Project → **Deploy from GitHub repo** → pick this repo and branch.
3. In the service settings, add a **Volume** mounted at `/data`.
4. Add variables: `DATA_DIR=/data`, `APP_PASSWORD=<team password>`, and
   `GOOGLE_SERVICE_ACCOUNT_JSON=<the key file contents, pasted as one line>`.
   (Optionally `ANTHROPIC_API_KEY` + `ENABLE_LLM_COMMENTARY=true`.)
5. Deploy, then Settings → Networking → **Generate Domain**. Set
   `NEXT_PUBLIC_APP_URL=https://<that domain>` and redeploy.

On first boot the volume is seeded from the bundled data (demo clients plus
any committed snapshots); after that, everything the team saves lives on the
volume and survives deploys.

## Going live

### 1. Environment variables

Copy `.env.example` to `.env` and fill in what you have. Nothing is mandatory —
missing pieces degrade gracefully to mock/fallback behaviour.

| Variable | Purpose |
|---|---|
| `APP_PASSWORD` | Team sign-in password (protects everything except share links) |
| `CONFIG_BACKEND` | `local` (default, built-in DB) or `sheets` |
| `GOOGLE_SHEET_ID` | Only for `CONFIG_BACKEND=sheets` |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to a service-account key file (preferred) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Same key pasted inline (alternative) |
| `GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN` | OAuth fallback for Search Console |
| `SERANKING_API_KEY` | Reserved for the SE Ranking API adapter (stub in V1) |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Optional LLM commentary |
| `ENABLE_LLM_COMMENTARY` | `true` to allow LLM drafting (default `false`) |
| `COMMENTARY_MODE` | `rules_only` or `llm_draft` |
| `NEXT_PUBLIC_APP_URL` | The app's public address (used in share links) |
| `DATA_DIR` | Persistent storage directory on a host (e.g. `/data` on Railway) |

### 2. Google auth

Create a service account in Google Cloud (enable the **Search Console API**;
also the **Sheets API** if using the optional sheets backend), download its
JSON key, then:

- **Search Console**: add the service account's email
  (`…@…iam.gserviceaccount.com`) as a user on each GSC property
  (Settings → Users and permissions). If a property owner can't add it, use the
  OAuth variables instead — create an OAuth client, complete the consent flow
  once, and store the refresh token.

### 3. (Optional) The Google Sheets backend

Only relevant with `CONFIG_BACKEND=sheets` — skip this entirely when using the
default built-in database.

```bash
npm run setup-sheet
```

Creates any missing tabs with the correct headers and validates existing ones
(it never overwrites data; missing columns are reported for manual fixing).
Run it with no credentials to print the full expected structure.

**Tabs:** `Clients`, `ReportPeriods`, `ClientPages`, `ContentGroups`,
`ContentGroupUrls`, `TopicClusters`, `TopicClusterRules`, `DrawTasks`,
`RankingKeywords`, `RankingImports`, `AiSearchPrompts` (future),
`NarrativeOverrides`, `StrategicNotes`, `GeneratedReports` (written by the
generator). Allowed values (e.g. `page_role`: primary/secondary/supporting/
rest_of_site; DRAW categories: design_dev/reactive_seo/anything_else/writing)
are documented in `src/lib/types.ts` and mirrored in `data/mock/sheet.json`,
which doubles as a filled-in example of every tab.

### 4. Configure a client

Everything is done in the app's Admin section (see "Day-to-day use" above).
With the sheets backend, the same data can also be edited as rows:

1. **Clients**: one row per client (`client_key` is the stable slug used in URLs).
2. **ReportPeriods**: one row per month, with current + comparison date ranges
   and `status` = `ready` when it should be generated.
3. **ClientPages**: the key pages you actively work on, with role/type/priority.
4. **ContentGroups** + **ContentGroupUrls**: named URL groups
   (match types: `exact`, `contains`, `starts_with`).
5. **TopicClusters** + **TopicClusterRules**: named query groups; a cluster can
   have many rules (match types: `contains`, `exact`, `regex`) and a query may
   count towards several clusters.
6. **DrawTasks**: the month's work grid (completed this month / planned next month).
7. **RankingKeywords** (tracked set) and **RankingImports** (positions per period).

### 5. Generate and view

```bash
npm run generate-report -- --client=apex-design --period=2026-06
npm run generate-all-reports          # every period with status ready/pending
npm run generate-report -- --client=x --period=y --mock   # force mock data
npm run fetch-gsc -- --client=x --period=y                # debug: dump GSC rows
npm run dev                           # dashboard
```

Each run writes `data/reports/{client_key}/{period_key}.json` and upserts a row
in the `GeneratedReports` tab. **Snapshots are the source of truth**: they
contain the raw GSC rows, ranking imports, calculated metrics, findings and
commentary, so a report never changes retroactively when APIs are re-queried.
Commit them if you want the repo to be the archive.

## Rankings

Rankings are resolved from the first provider with data:

1. **SE Ranking API** — interface + stub in `src/lib/rankings.ts` (`SERankingProvider`).
   Wire it up when an API key and site-ID mapping are available.
2. **Local CSV import** — `npm run import-rankings-csv -- --file=export.csv
   --client=apex-design --period=2026-06`. Accepts SE Ranking-style exports
   (header aliases like "Current position", "Volume" are recognised); writes
   `data/rankings/{client}/{period}.json` and appends to the `RankingImports`
   tab when Sheets is configured.
3. **RankingImports sheet rows** — paste positions straight into the sheet.

`start_position` empty = keyword **entered**; `end_position` empty = **dropped**.
Put the account-level visibility score (e.g. `6` for 6%) in the
`visibility_score` column of any row for the client/period — the first
non-empty value is used; leave it blank to omit visibility from the report.

## How commentary works

1. **Findings engine** (`src/lib/findingsEngine.ts`) turns the calculated
   metrics into a structured findings object — every number in the report is
   computed in code, never by an LLM.
2. **Rules commentary** (`src/lib/commentaryRules.ts`) renders those findings
   as plain-English paragraphs. This always runs and is the guaranteed fallback.
3. **LLM commentary** (`src/lib/llmCommentary.ts`, Anthropic first, provider
   interface for others) optionally re-drafts the wording from the findings
   only — it's instructed to use nothing else, hedge weak findings, and never
   invent causes. Enable with `ENABLE_LLM_COMMENTARY=true` + `ANTHROPIC_API_KEY`.
   Any failure silently falls back to rules text.
4. **Human overrides**: put final wording in the `NarrativeOverrides` tab
   (`section` = `executive_summary`, `traffic`, `content_groups`,
   `topic_clusters`, `cannibalisation`, `rankings`, `strategic_priorities`);
   the dashboard shows the override as final with the suggestion collapsed
   underneath, and the snapshot stores both `suggestedText` and `finalText`.

## Tests

`npm test` covers CTR/weighted-position maths, comparison rules (0→0 is 0%,
0→n is `null`/"new", never `Infinity`), content-group aggregation and URL
matching, topic-cluster matching (incl. regex and multi-cluster overlap),
cannibalisation detection and priority ordering, ranking movement
classification and summaries, and commentary fallback/override behaviour.

## Included in V1

Mock mode end-to-end · sheet setup/validation · GSC adapter (live, paginated)
with mock fallback · content groups · topic clusters · cannibalisation catcher ·
rankings via CSV/sheet import · deterministic findings + rules commentary ·
optional Anthropic commentary · human overrides · JSON snapshots · dashboard
with sortable tables, growth bars and a collapsed raw-data panel.

## Intentionally deferred (schema/architecture ready)

- **Conversions/enquiries & GA4** — `snapshot.future.conversions/ga4` are
  reserved; add an adapter beside `gsc.ts` when clients are ready.
- **AI-search visibility** — configure prompts now in `AiSearchPrompts`;
  results live at `snapshot.future.aiSearch.results` once tracking exists.
- **SE Ranking live API** — provider stub exists; CSV import is the V1 path.
- **PDF export, client portal, permissions** — dashboard is internal-only.

## Known limitations

- The `GeneratedReports`/`RankingImports` writers assume the generator is the
  only concurrent writer (fine for a small team; no locking).
- Cannibalisation looks at the current period only (no MoM issue tracking yet).
- A query matching several topic clusters is counted in each (documented,
  intentional for V1).
- Sheet reads pull whole tabs (fine to thousands of rows per tab).
- LLM drafts are cached only inside the snapshot; regenerating a report re-asks
  the LLM (or falls back to rules) and may word things differently — overrides
  in the sheet are the way to pin wording.
