# NBS Nordic-integration — samlet status

Rå evidens/citater fra 2026-09-09 ligger i `docs/archive/2026-09-09-nbs/`; slå
kun op der for fulde kommandoer og API-svar bag en konklusion.

## Status til næste udvikler (Codex)

- Trin 3: additiv RuleEngine og deterministisk routing for væghøjde, vægschedule, typeomdøbning og NBS-sync; dansk/engelsk normalisering.
- Allow-list, 20-step-grænse og faste validate/verify-templates håndhæves; NBS genbruger ét atomisk sync-write med preview.
- Verificeret: build:check, NBS 25/25, foundation 4/4 (151 uændrede tool-kontrakter), routing 10/10.
- Næste skridt efter review: agent-entrypoint i plan-only mode; execution, runtime-kontroller og live-tests afventer.

- Tool-Agent foundation trin 1-2 er implementeret: feature flag er default off, og 151 tool-kontrakter er frosset som snapshot.
- Workflow-cache og audit har separate interfaces, schema migration v1 og separate filer (`workflow-cache.db` / `audit-log.db`) fra `revit-data.db`.
- Verificeret med `tsc --noEmit`, 25/25 NBS-tests og 4/4 nye contract/cache-tests.
- Næste skridt efter review: RuleEngine og deterministic routing; ingen agent-entrypoint er tilføjet endnu.

Klassifikations-serienummer-bugget (projekt 13365, komponenter
343271/343277/343278/343291, koder `[L]%AD130`/`[L]%AD140`) er
**rodårsagsbestemt, rettet, testet og pushet** (`dcfd02c`, `c69e7fb`,
`origin/main`).

- **Rodårsag**: NBS' eget create-endpoint trunkerer stiltiende en
  `classificationcode` med indlejret serienummer (`"[L]%AD130"` → gemt som
  `"[L]%AD"`, cifrene smides væk) — ingen fejl. Ikke vores parser.
  [`ClassificationLookup.ts:81-102`](../server/src/integrations/nbs/classification/ClassificationLookup.ts#L81-L102)
  (`detectEmbeddedSerial`).
- **Fix**: `nbs_create_component` afviser nu kaldet før HTTP-requesten, hvis
  koden ligner gruppekode+serie.
  [`nbs_create_component.ts:38-50`](../server/src/tools/nbs_create_component.ts#L38-L50).
  Test dækker separatorer + no-op-cases i `nbs-connection.test.ts`. 25/25
  tests, `tsc --noEmit` rent.
- `description`/`structure` var ikke en bug — spredes uændret til HTTP-body
  ([`ComponentService.ts:10-22`](../server/src/integrations/nbs/components/ComponentService.ts#L10-L22)),
  kom tomme fordi kaldende agent ikke havde en verificeret kilde.

**Ikke løst:** selve serie-tildelingen (`.001→.002→.002→.002` på hurtige
kald) er NBS' eget serverdesign, ikke noget klientkoden styrer.

**Videre:**
1. Live end-to-end-test: opret én komponent med bar gruppekode + rigtig
   `description`/`structure`, bekræft unik serie og persisteret metadata.
2. "Type and Instance" for komponent-oprettelse er aldrig kørt end-to-end.

**Ikke-blokerende:** `343271`/`343277`/`343278`/`343291` (proj. 13365) og
`343221`–`343224` (proj. 10973) er tomme testartefakter — bruger kunne ikke
finde dem i web-UI'en for at slette. Harmløse, spring over.

## NBS-datamodel

`instance` (Revit-element, kun mængder) → `category` (Revit-type, ét
`component_id`) → `component` (bygningsdel: `classificationcode` +
`classificationserial`, serien adskiller **bygningsdele**, ikke elementer).
96 identiske vægge = 96 instanser under **én** bygningsdel, korrekt.

1:1 Revit↔NBS bevist på `UniqueId`, gemt server-side i NBS' tabel
`Model-Instances` (ikke i Revit). Se
`docs/archive/2026-09-09-nbs/nbs-instance-link-evidence-2026-09-09.md`.

`NBS Instance Manual Tag` uploades ikke af det officielle addin — ingen måde
at give elementer unikke synlige navne i NBS i dag.

## Rettede fejl (commit → én linje)

1. `70f9b23`/`162e358`/`52b7250` — component/sheet/quantities-POST findes kun
   på `/api/v1`, dok. lister dem forkert som v2.
2. `10d7d0f` — JSON-datoer ødelagt af Newtonsoft-parsing; fejlsvar uden
   request-id.
3. `1c8a42b` — NBS Date-ping-pong (vores sync overskrev addin'ets
   tidsstempelformat).
4. Native Sync Now-reparation — manglende `NBS Override`/`NBS Project Date`,
   13 kernefelter provisioneres nu. Se
   `docs/archive/2026-09-09-nbs/nbs-native-sync-repair-2026-09-09.md`.
5. `dcfd02c`/`c69e7fb` — klassifikationskode med indlejret serienummer, se
   status-afsnittet ovenfor.

## Reference

- `NBSLinkType` (i `NBS Override`, udokumenteret): `0` = Type and Instance,
  `1` = Type Only, `2` = Instance Only (kun 0/1 set live). Se
  `docs/archive/2026-09-09-nbs/nbs-linktype-mapping-2026-09-09.md`.
- Serie-kollision ved hurtige på-hinanden-følgende oprettelser: kun opdages,
  ikke forhindres, fra klientsiden.
- `setComponentExtraField` (Pro-only ifølge dok.): 404 på v1 og v2.
- Live post-genstart-røgtest af den permanent installerede native
  sync-reparation ikke kørt endnu (kræver Revit åben igen).

## Kilder

[NBS API](https://support.nbsnordic.dk/article/75-api-dokumentation) ·
[NBS-parametre](https://support.nbsnordic.dk/article/88-hvilke-parameter-opretter-nbs-nordic) ·
[Settings](https://support.nbsnordic.dk/article/92-overblik-over-settings) ·
[Sync-fejl](https://support.nbsnordic.dk/article/119-der-opstar-en-fejl-nar-man-prover-at-synkronisere) ·
rå evidens: `docs/archive/2026-09-09-nbs/*.md`
