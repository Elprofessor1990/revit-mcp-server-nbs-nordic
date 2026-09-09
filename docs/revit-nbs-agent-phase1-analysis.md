# Revit + NBS Nordic MCP — fase 1–3 analyse og design

Dato: 2026-09-09  
Scope: analyse, tool inventory, gap-analyse og design. Ingen runtime-kode er ændret.

## 1. Konklusion

Repositoryet har allerede et stort MCP/Revit-fundament og en væsentligt mere moden NBS-sync end målarkitekturens afsnit 7 beskriver:

- 151 MCP-tools registreres aktuelt. Den fulde inventory ligger i [`mcp-tool-inventory.csv`](./mcp-tool-inventory.csv).
- `sync_revit_types_to_nbs` understøtter eksplicit `typeOnly`, `instanceOnly` og `typeAndInstance`.
- Ved `typeAndInstance` planlægges separate writes til `NBS Classificationcode` på typen og `NBS Instance Classificationcode` på instansen.
- Alle planlagte NBS-parameterwrites forhåndsvalideres, skrives i én Revit-transaktion og verificeres med `AsString()` efter `Set()`; en fejl afbryder transaktionen.
- Parameterbindingslogikken genbruger eksisterende GUID-baserede shared parameters og afviser konflikter i stedet for at oprette dubletter.
- Den manglende del er primært Tool-Agent/router, regelmotor, bounded workflow-cache og en dækkende persistent revisionslog. Den eksisterende `nbs_sync_log`-tabel er ikke koblet til sync-flowet og kan ikke opfylde logkravet.

Målarkitekturens afsnit 7, “synkroniserer i praksis kun værdien til Type Parameter”, er derfor forældet. Kravet om Type + Instance er **EXISTS**, ikke MISSING. Den relevante restgæld er logdetaljer, eksplicit fejlklassifikation og en ny live end-to-end-demonstration med den permanente Revit-installation.

## 2. Kildegrundlag

- Status/worklog: `docs/nbs-integration-worklog.md`.
- Normativ målbeskrivelse: de vedhæftede `revit_nbs_agent_architecture.md` og `.json`.
- Visuelle referencer: arkitekturbillederne fra 20.55.35 og 21.42.55. Det andet billede tilføjer Tool-Agent, lokal cache, TTL/oprydning og eksplicit Type + Instance-flow.
- Toolregistrering: `server/src/tools/register.ts:153-322` samt de faktiske `server.tool(...)`-kald.
- NBS sync: `server/src/tools/sync_revit_types_to_nbs.ts:14-106`.
- Sync-plan: `server/src/integrations/nbs/matching/SyncPlanner.ts:61-149`.
- Revit-side validering og write: `plugin/Core/NbsProjectBridge.cs:112-143`.
- Binding/dubletbeskyttelse: `plugin/Core/NbsProjectBridge.cs:194-289`.
- Eksisterende database: `server/src/database/db.ts:10-181`.
- NBS-tests: `server/tests/nbs-connection.test.ts:119-197` og `:252-297`.

## 3. Tool inventory

Den fulde inventory er maskinlæsbar i [`mcp-tool-inventory.csv`](./mcp-tool-inventory.csv) og indeholder:

`tool_id`, `purpose`, `read_write`, `Revit category`, `inputs`, `outputs`, `side_effects`, `validation`, `status` og `source_file`.

### 3.1 Overblik

- Faktiske `server.tool(...)`-registreringer: **151**.
- `server/src/tools/register.ts` har 149 modulposter; `nbs_project_connection.ts` registrerer tre tools (`get_connection_status`, `nbs_connect_project`, `nbs_clone_project`) og forklarer nettototalen 151.
- README-oplysningen “Supported Tools (124)” er forældet og bør senere genereres fra inventory/registreringskilden.
- Der er ingen eksisterende Tool-Agent, intent-router, tool-ranker eller workflow-cache.
- Der findes fem sammensatte `workflow_*`-tools, men de er domænespecifikke workflows, ikke et generelt routing-/planlægningslag.

### 3.2 Eksisterende tools til de fire reference-intents

| Intent | Genbrugelig eksisterende sekvens | Vurdering |
|---|---|---|
| Væghøjde på valgte vægge | `get_selected_elements` → `get_element_parameters` → `set_element_parameters` → `get_element_parameters` | Tools findes; router, fælles policy og audit mangler. |
| Vægschedule | `list_schedulable_fields` → `create_schedule` → `get_schedule_data` | Tools findes. Feltvalidering bør ske via første trin. |
| Omdøb valgte typer | `get_selected_elements` → udled unikke type-id'er → `batch_rename` med type-id'er → read-back | Muligt med eksisterende tools. `rename_families` er ikke et rent type-only valg, fordi `renameTypes=true` også behandler familienavne. |
| NBS classification sync | `get_connection_status` → `sync_revit_types_to_nbs` dry-run med `linkMode=typeAndInstance` → samme sync med `dryRun=false` | Den specialiserede sync indeholder allerede plan, validate, write og verify; genbrug den som atomisk orchestrator-step. |

## 4. Direkte verifikation af Type + Instance

### EXISTS

`SyncPlanner.buildSyncPlan` beregner:

- `includeTypes = linkMode !== "instanceOnly"`
- `includeInstances = linkMode !== "typeOnly"`

For klassifikationsfeltet bruger den:

- type: `NBS Classificationcode`
- instance: `NBS Instance Classificationcode`

Ved `typeAndInstance` køres både type- og instance-grenen. Eksisterende instance-links bevares, og en type-link arves kun til helt ukoblede instanser, når `inheritTypeForUnlinkedInstances=true` er valgt eksplicit.

`NbsProjectBridge.WriteParameters`:

1. kontrollerer modelnøgle og NBS-projekt,
2. tillader kun den faste `RequiredNames`-liste,
3. afviser manglende, read-only og ikke-string parametre,
4. sammenligner `previousValue` for optimistic concurrency,
5. udfører alle writes i én transaktion,
6. læser værdien tilbage med `AsString()` efter hvert `Set()`,
7. fejler uden commit, hvis én write ikke kan verificeres.

`NbsProjectBridge.Connect` gennemgår eksisterende parameterbindingsdefinitioner og GUID'er. En navne-/GUID-konflikt eller forkert type-/instance-binding afvises; en eksisterende korrekt binding udvides med manglende kategorier via `ReInsert`. Det er den relevante dubletbeskyttelse.

### Verifikationsresultater i denne gennemgang

- `npm run build:check`: bestået.
- `npm run test:nbs`: **25/25 bestået**.
- `dotnet run --project tests/nbs-compatibility/NbsCompatibility.Tests.csproj --no-restore`: **16/16 PASS**.

Det er stadig rimeligt at kræve en ny live Revit-røgtest som release-gate, fordi workloggen siger, at post-genstartstesten af den permanent installerede native sync-reparation mangler. Det ændrer ikke kodeklassifikationen fra EXISTS.

## 5. Gap-analyse mod acceptkriterierne

| # | Acceptkriterium | Status | Evidens | RISK | RECOMMENDATION |
|---:|---|---|---|---|---|
| 1 | Eksisterende MCP-tools virker fortsat | **PARTIAL** | 151 tools registreres statisk; TypeScript-check og NBS-tests består. | Ingen fuld 151-tool Revit-regression blev kørt; README og faktisk inventory er ude af sync. | Tilføj et tool-contract snapshot og representative Revit smoke-tests; behold alle eksisterende tool-id'er og schemas bag feature flag. |
| 2 | Kendte intents kan mappes til eksisterende tools | **PARTIAL** | Alle fire reference-intents kan sammensættes af eksisterende tools; NBS-intentet har allerede et specialiseret sync-tool. | Ingen intent-normalisering, katalogforespørgsel eller deterministisk router findes. | Implementér deterministic-first routing med de fire workflows som fixtures; fallback skal returnere en eksplicit plan, ikke gætte et tool-id. |
| 3 | Kendte workflows kan genbruge cachede tool-planer | **MISSING** | Ingen workflow-cache/rankingkode blev fundet. | En naiv cache kan gemme element-id'er, NBS-data eller forældede schemas. | Cache kun versionsstyrede plantemplates med placeholders og catalog fingerprint; genbrug først efter mindst to succeser. |
| 4 | Cache har maksimal størrelse og automatisk oprydning | **MISSING** | Eksisterende DB har ingen workflow-cache, TTL eller LRU. `McpLogger`-retention er kun logfiloprydning. | Ubegrænset vækst og stale routing. | Defaults: 500 entries, 30 dage, max 20 steps; prune ved startup og efter writes med TTL + LRU. |
| 5 | Cache kan slettes uden at MCP stopper | **MISSING** | Ingen cache findes. Den eksisterende `revit-data.db` rummer også anden data. | Hvis cache blandes ind i `revit-data.db`, kan “clear cache” slette mappings/projektdata. | Brug separat `workflow-cache.db`; manglende/korrupt fil skal give cache miss og ny tom cache, mens tool discovery fortsætter. |
| 6 | `L%AD001` kan synkroniseres fra NBS til Revit | **EXISTS** | `fullClassification` sammensætter NBS-kode + NBS-separator + serial uden at gætte; sync skriver den planlagte værdi. | Det præcise output afhænger af projektets separator. Manglende separator afvises med vilje. | Behold denne adfærd; tilføj fixture for tom separator, der giver præcis `L%AD001`, samt live release-test. |
| 7 | Koden skrives til både Type Parameter og Instance Parameter | **EXISTS** | `typeAndInstance` planlægger både `NBS Classificationcode` og `NBS Instance Classificationcode`; test dækker uafhængige instance-links og field selection. | Et kald kan stadig vælge `typeOnly`/`instanceOnly`; routeren må ikke kalde det fuld dual sync. | For intentet “begge niveauer” skal reglen kræve eksplicit `linkMode=typeAndInstance` og `fields` med `classificationcode`. |
| 8 | Begge værdier verificeres efter write | **EXISTS** | Hver `Set()` efterfølges af `AsString()`-sammenligning; tool-laget kræver `verified=true` og forventet write-count. | Verifikationen sker inde i transaktionen, ikke via en ny snapshot efter commit. | Behold atomisk verifikation; overvej et valgfrit post-commit snapshot i live-test/orchestrator for særlig høj assurance. |
| 9 | Dubletter undgås | **EXISTS** | Planner skriver kun ændrede værdier; connect genbruger korrekte GUID-bindings og afviser konflikter/forkert binding. | Kravet er dækket for NBS-parametre, ikke bevist som global egenskab for alle 151 tools. | Kod reglen specifikt for parameteroprettelse og behold den eksisterende NBS-bindinglogik urørt. |
| 10 | Alle writes logges | **PARTIAL** | Requests indeholder `previousValue`, og tool-resultatet rapporterer antal/verified. Der findes `nbs_sync_log`, men ingen kode skriver til den; generelle logs er ikke en per-write revision journal. | Fejl, gamle/nye værdier og målobjekter er ikke persistent/auditerbart dækket for alle write-tools. | Indfør append-only `audit_events`; log tool-level for alle writes og change-level for parameterwrites. NBS-syncens eksisterende requestliste skal genbruges som audit-input. |
| 11 | Fejl i én parameter rapporteres tydeligt | **PARTIAL** | NBS-sync er all-or-nothing og fejler på missing/read-only/stale/verification mismatch. | Nogle fejltekster mangler element/parameter-level target og en stabil `type_write_failure`/`instance_write_failure`-kode. | Returnér struktureret fejl med `scope`, `uniqueId`, `parameterName`, `stage`; log rollback. Rapportér aldrig delvis success, når transaktionen rulles tilbage. |
| 12 | Agenten kan slås fra, og MCP fungerer normalt | **MISSING** | Der er endnu ingen agent. | En invasive registreringsrefaktor kan gøre normale tools afhængige af agent/cache. | Agenten skal være opt-in via config/feature flag. Registrér og kør de 151 tools som i dag uanset agentstatus; cachefejl må degraderes til normal discovery. |

## 6. Designforslag

### 6.1 Designprincip

Behold eksisterende tools og især `sync_revit_types_to_nbs` som execution primitives. Læg et valgfrit lag ovenpå:

```text
intent
  -> IntentNormalizer
  -> ToolCatalog
  -> RuleEngine
  -> WorkflowRanker (cache er kun et signal)
  -> WorkflowPlan
  -> plan/confirm boundary for writes
  -> WorkflowOrchestrator
  -> eksisterende tool handlers
  -> verification
  -> AuditSink
  -> WorkflowCache feedback
```

Routeren må aldrig kalde `send_code_to_revit` automatisk. Den må ikke generere nye tool-id'er eller ændre regler. Et cache-hit er kun gyldigt, hvis tool-katalogets fingerprint og workflow-schema-version matcher.

### 6.2 Filer der bør ændres

| Fil | Minimal ændring |
|---|---|
| `server/src/tools/register.ts` | Fang metadata/handlers i et katalog under den eksisterende registrering uden at ændre eksisterende tool-id'er; registrér agent-entrypoint kun når feature flag er aktivt. |
| `server/src/index.ts` | Initialisér agent config, separat cache og pruning; fejl i agent/cache må ikke forhindre normal MCP-start. |
| `server/src/utils/compactTool.ts` | Tilføj stabil result/error-envelope metadata (`errorCode`, `runId`) uden at bryde eksisterende content-format. |
| `server/src/tools/sync_revit_types_to_nbs.ts` | Genbrug `plan.requests` til audit events; returnér struktureret type/instance-scope ved fejl. Ændr ikke matching/linkMode-semantikken. |
| `plugin/Core/NbsProjectBridge.cs` | Berig write-resultat/fejl med parameter, target og scope; behold allow-list, optimistic concurrency, transaktion og verifikation. |
| `server/src/database/db.ts` | Kun hvis eksisterende DB-abstraktion genbruges: tilføj en migrationsmekanisme. Workflow-cache anbefales dog i separat fil/store. |
| `server/package.json` | Kun ved valg af native SQLite-driver; ellers ingen ny dependency i første prototype. |

### 6.3 Nye filer

```text
server/src/agent/AgentConfig.ts
server/src/agent/ToolCatalog.ts
server/src/agent/IntentNormalizer.ts
server/src/agent/RuleEngine.ts
server/src/agent/WorkflowRanker.ts
server/src/agent/WorkflowOrchestrator.ts
server/src/agent/types.ts
server/src/agent/cache/WorkflowCache.ts
server/src/agent/cache/SqliteWorkflowCache.ts
server/src/agent/audit/AuditSink.ts
server/src/agent/audit/SqliteAuditSink.ts
server/src/tools/orchestrate_workflow.ts
server/tests/agent/*.test.ts
```

`orchestrate_workflow` er et foreslået nyt navn, verificeret ikke-kolliderende mod inventoryet. Det bør først fastlåses ved designgodkendelse. Ét entrypoint med `mode: "plan" | "execute"` er mindre invasivt end flere nye meta-tools.

### 6.4 Interfaces

```ts
type AccessMode = "READ" | "WRITE" | "MIXED";

interface ToolDescriptor {
  toolId: string;
  purpose: string;
  access: AccessMode;
  categories: string[];
  inputSchemaFingerprint: string;
  sideEffects: string[];
  risk: "low" | "medium" | "high";
}

interface WorkflowStep {
  toolId: string;
  argsTemplate: Record<string, unknown>; // placeholders, ikke live modeldata
  phase: "read" | "validate" | "write" | "verify";
}

interface WorkflowPlan {
  schemaVersion: number;
  intentKind: string;
  intentSignature: string;
  catalogFingerprint: string;
  steps: WorkflowStep[];
  requiresConfirmation: boolean;
}

interface RuleDecision {
  allowed: boolean;
  code: string;
  reasons: string[];
}

interface WorkflowCache {
  lookup(signature: string, catalogFingerprint: string): Promise<WorkflowPlan[]>;
  recordSuccess(plan: WorkflowPlan, elapsedMs: number): Promise<void>;
  recordFailure(plan: WorkflowPlan, code: string): Promise<void>;
  prune(now: number): Promise<void>;
  clear(): Promise<void>;
}

interface AuditEvent {
  timestamp: number;
  runId: string;
  intentKind: string;
  toolId: string;
  targetKind: string;
  targetId: string;
  oldValue: unknown;
  newValue: unknown;
  outcome: "success" | "failure" | "rolled_back";
  verified: boolean;
  errorCode?: string;
  errorMessage?: string;
}
```

### 6.5 Cache-schema

Cache og audit bør ikke ligge i `revit-data.db`, fordi sletning af cache ellers kan påvirke projekt-/room-/NBS-mappings. Brug to separate stores: `~/.mcp-revit/workflow-cache.db` til genbrugelige planer/runs og `~/.mcp-revit/audit-log.db` til revisionsloggen. Dermed kan cachefilen fysisk slettes uden at slette audit eller autoritative mappings.

`workflow-cache.db`:

```sql
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE workflow_cache (
  id INTEGER PRIMARY KEY,
  intent_signature TEXT NOT NULL,
  intent_kind TEXT NOT NULL,
  catalog_fingerprint TEXT NOT NULL,
  workflow_schema_version INTEGER NOT NULL,
  plan_json TEXT NOT NULL,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  avg_execution_ms REAL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  UNIQUE(intent_signature, catalog_fingerprint, plan_json)
);

CREATE INDEX idx_workflow_cache_lookup
  ON workflow_cache(intent_signature, catalog_fingerprint, expires_at);
CREATE INDEX idx_workflow_cache_prune
  ON workflow_cache(expires_at, last_used_at);

CREATE TABLE workflow_runs (
  run_id TEXT PRIMARY KEY,
  workflow_id INTEGER,
  intent_kind TEXT NOT NULL,
  cache_hit INTEGER NOT NULL,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  error_code TEXT
);

```

`audit-log.db`:

```sql
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE audit_events (
  id INTEGER PRIMARY KEY,
  run_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  tool_id TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  old_value_json TEXT NOT NULL,
  new_value_json TEXT NOT NULL,
  outcome TEXT NOT NULL,
  verified INTEGER NOT NULL,
  error_code TEXT,
  error_message TEXT
);
```

Policy:

- `max_entries=500`
- `ttl_days=30`
- `min_success_count_for_reuse=2`
- `max_workflow_steps=20`
- pruning ved startup og efter cache-write
- først TTL-delete, derefter LRU til max 500
- aldrig API keys, rå prompts, modeludtræk, element-id-lister eller autoritative NBS-værdier i `plan_json`
- auditloggen har separat fil, retention og configuration og må ikke slettes af “clear cache”

### 6.6 Tool-routing

1. Normalisér kun til en begrænset intent-signatur, fx `wall.height.set.selection`.
2. Slå deterministiske, versionsstyrede workflows op før fuzzy matching.
3. Filtrér alle kandidater gennem allow-list og RuleEngine.
4. Brug cache-score:

   `intent_similarity + success_rate + recency_weight - failure_penalty`.

5. Kræv mindst to tidligere succeser og korrekt catalog fingerprint før reuse.
6. Ved cache miss: brug ToolCatalog til eksplicit plan; cache miss er ikke en fejl.
7. Ved writes: returnér først plan/dry-run; execution kræver plan-id/confirmation.
8. Efter hvert write: kør den angivne verify-step og skriv audit event.
9. Ved NBS dual sync: brug `sync_revit_types_to_nbs` som ét atomisk step med `linkMode=typeAndInstance`, `fields` indeholdende `classificationcode`, først `dryRun=true`, derefter `false`.
10. Hvis agenten er deaktiveret eller cache/store fejler, registreres og virker alle eksisterende tools fortsat direkte.

### 6.7 Regelmotor v1

Reglerne skal være statiske, versionsstyrede og ikke cachebare:

- kun inventory-/allow-listede tools
- `send_code_to_revit` deny-by-default
- write-plan kræver read/validate før write og verify efter write
- max 20 steps
- NBS project/model identity må ikke ændre sig mellem preview og write
- NBS-parameterwrites må kun ramme eksisterende `RequiredNames`
- dual classification sync kræver både type- og instance-scope
- cache kan aldrig ændre eller overrule en rule decision
- ingen hemmeligheder eller live model/NBS-data i cache

### 6.8 Tests

**Contract/regression**

- snapshot af alle 151 tool-id'er og input-schema fingerprints
- assert at agent disabled giver samme 151 tools og samme schemas
- assert at agent enabled kun tilføjer det godkendte entrypoint og ikke ændrer gamle tools

**Routing**

- de fire reference-intents mapper til de konkrete sekvenser i afsnit 3.2
- ukendt intent giver eksplicit fallback, ikke opdigtet tool
- `send_code_to_revit` kan ikke vælges automatisk
- Danish/English variants giver samme normaliserede intent

**Cache**

- reuse først efter to successes
- TTL, LRU og max 500
- schema/catalog fingerprint invaliderer gammel plan
- sletning og korruption giver cache miss og normal fallback
- ingen element-id'er, rå prompts, NBS-værdier eller secrets persisteres

**Rules/orchestration**

- write uden validate/verify afvises
- delvis step-fejl stopper workflow og logger failure/rollback
- agent off bypasser router men ikke eksisterende tools

**NBS**

- behold alle eksisterende 25 TypeScript-tests og 16 compatibility checks
- tilføj præcis fixture: `classificationcode="L%AD"`, separator `""`, serial `"001"` → `L%AD001`
- `typeAndInstance` giver begge parameterwrites med identisk full code
- type- og instance-fejl returnerer stabile, forskellige error codes med target
- live Revit-test: preview → write → separat read-back af type og instance → gentaget sync er no-op

## 7. Migrations- og driftsrisici

1. **`sql.js` er ikke multi-process SQLite.** Den nuværende implementation holder databasen i memory og overskriver hele filen ved flush. Flere samtidige MCP-processer kan overskrive hinandens data. Prototype kan genbruge `sql.js` med en dokumenteret single-writer-antagelse og atomisk filudskiftning; robust multi-client drift kræver native SQLite med WAL eller én lokal broker-proces.
2. **Separér cache fra eksisterende data.** `revit-data.db` indeholder projects, rooms og NBS mappings. Cache deletion må aldrig ramme den fil.
3. **Schema-version mangler.** Nuværende DB bruger kun `CREATE TABLE IF NOT EXISTS`. Nye stores bør have `schema_migrations` fra dag ét.
4. **Registreringsrefaktor er høj blast radius.** Undgå at ændre alle 151 toolfiler. Fang katalogmetadata centralt og beskyt med contract snapshot.
5. **Output compatibility.** Nye `runId`/error-felter skal være additive; eksisterende MCP content må ikke ændres.
6. **Generel audit er større end NBS audit.** NBS-sync har allerede old/new i `ParameterWrite`; mange andre write-tools gør ikke. Implementér NBS/routed parameterwrites først, men markér global “alle writes”-accept som åben, indtil øvrige handlers leverer change envelopes.
7. **Live Revit afhængighed.** Unit-tests kan bevise plan og policy; kun Revit kan bevise bindings-, transaktions- og UI/installationsadfærd.
8. **NBS API-begrænsninger.** Implementeret og verificeret scope er READ, component CREATE, project clone, quantity/schedule POST, classification lookup, document read og mappings/sync. Generisk component UPDATE/DELETE og dokument-write findes ikke og må ikke antages.

## 8. Anbefalet implementeringsrækkefølge efter godkendelse

1. Frys tool-contract snapshot og feature flag; ingen adfærdsændring.
2. Tilføj separat cache/audit interfaces og migrationsschema.
3. Implementér RuleEngine og deterministic routing for de fire reference-intents.
4. Tilføj det ene godkendte agent-entrypoint i plan-only mode.
5. Genbrug NBS syncens eksisterende dry-run/write/verify-flow og tilføj audit/error envelopes.
6. Aktivér confirmed execution, cache feedback og pruning.
7. Kør unit/contract/compatibility tests.
8. Kør live Revit dual-write test og agent-off regression før merge.
