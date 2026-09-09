# NBS Nordic-integration — samlet status og arbejdslog

Erstatter seks separate dagsnoter fra 2026-09-09, som nu ligger som rå
evidens/citater i `docs/archive/2026-09-09-nbs/`. Denne fil er indgangen —
læs den først; slå kun op i arkivet for fulde citater, kommandoer og rå
API-svar bag en konklusion.

## Status til næste udvikler (Codex)

Den åbne undersøgelse — hvorfor `nbs_create_component` gav forkert
klassifikation, tom `description/structure` og en serie der gik
`001 → 002 → 002 → 002` (projekt 13365, komponenter 343271/343277/343278/343291,
kildekoder `[L]%AD130`/`[L]%AD140`) — er **allerede rodårsagsbestemt og delvist
rettet, men rettelsen er ucommittet** i working tree lige nu:

- **Rodårsag fundet**: NBS' eget create-endpoint (`POST /projects/{id}/component`)
  accepterer stiltiende en `classificationcode` med et løbenummer klistret på
  (`"[L]%AD130"`), men **trunkerer server-side** til gruppekoden (`"[L]%AD"`) og
  smider cifrene væk — ingen fejl, ingen advarsel. Det er ikke vores parser, der
  splitter den; det er NBS' server. Se docstring og live-bevis i
  [`ClassificationLookup.ts:81-102`](../server/src/integrations/nbs/classification/ClassificationLookup.ts#L81-L102)
  (funktionen `detectEmbeddedSerial`).
- **Klientside-fix skrevet** (ucommitted): `nbs_create_component` kalder nu
  `detectEmbeddedSerial` på input og **afviser kaldet før HTTP-requesten**, hvis
  koden ligner en gruppekode med serienummer klistret på — se
  [`nbs_create_component.ts:38-50`](../server/src/tools/nbs_create_component.ts#L38-L50).
  Værktøjsbeskrivelsen og `nbs_lookup_classification`s beskrivelse er opdateret
  til at sige eksplicit: kun bar gruppekode til create, `classificationserial`
  kan slet ikke sættes.
- **Test skrevet** (ucommitted): `server/tests/nbs-connection.test.ts` har et nyt
  case `"detectEmbeddedSerial catches a group code with a serial concatenated on…"`
  der dækker `.`/`-`/`_`-separatorer, bare gruppekoder (no-op) og ukendte/ikke-CCI
  koder (no-op). `server/test-nbs.mjs` er rettet til at kopiere
  `cci-hierarchy.json` med til testbundlet.
- **`description`/`structure` var ikke en bug**: de kom tomme tilbage i de
  originale kald, fordi den kaldende agent bevidst undlod at udfylde dem uden en
  verificeret kilde — værktøjsbeskrivelsen forbyder eksplicit at opfinde dem.
  Spor bekræftet: begge felter spredes uændret fra tool-argumenter til
  HTTP-body i [`ComponentService.ts:10-22`](../server/src/integrations/nbs/components/ComponentService.ts#L10-L22)
  (`body: data` — ingen mellemliggende transformation).

**Hvad der IKKE er løst:** selve serie-tildelingen (`001 → 002 → 002 → 002` på
fire kald med samme gruppekode) er NBS' eget interne ansvar og ikke noget
klientkoden kan styre eller forudsige — kun mistaget "kode med indlejret
serienummer" er nu blokeret før afsendelse. Se
`docs/archive/2026-09-09-nbs/nbs-component-serial-2026-09-09.md` for det fulde
bevis (samme mønster ramte fire tests i projekt 10973 tidligere samme dag).

**Før du går videre:**
1. Kør `git diff` i repoet — sæt dig ind i de ucommittede ændringer i
   `ClassificationLookup.ts`, `nbs_create_component.ts`, `nbs_lookup_classification.ts`,
   `server/test-nbs.mjs`, `server/tests/nbs-connection.test.ts`, `README.md` og
   `plugin/tool_schemas.json`, kør testsuiten, og commit dem hvis de holder —
   de er ikke committed endnu.
2. **Ryd testdata i NBS' web-UI manuelt** (API'et kan ikke slette/rette):
   - Projekt 13365: komponenter `343271`, `343277`, `343278`, `343291`
     (alle `[L]%AD.001`/`.002`, tom description/structure — rene testartefakter
     fra denne undersøgelse).
   - Projekt 10973: komponenter `343221`–`343224` ("MCP-testvæg 01"–"04",
     alle `.004`, fra en tidligere serie-test samme dag).
3. Overvej om der er behov for en *live* end-to-end-test efter commit: opret én
   ny komponent med en bar gruppekode og en rigtig `description`/`structure`,
   bekræft at serien er unik ved oprettelsen, og at begge felter er persisteret
   i NBS bagefter. Det er ikke gjort endnu — kun enhedstesten af
   `detectEmbeddedSerial` er kørt.
4. "Type and Instance"-koblingstilstand (`NBSLinkType=0`) er aldrig kørt
   end-to-end for komponent-oprettelse — se afsnittet "Ikke verificeret" nedenfor.

## Bekræftet NBS-datamodel

Kilde: `GET /api/v2/projects/{id}/instances` (253 instanser på tværs af 4
modeller, projekt 10973) og `GET /api/v2/export-backup/{id}` (Model-Instances/
Model-Categories CSV, som det offentlige API ellers skjuler).

| Objekt | Felter | Kobling |
|---|---|---|
| `instance` | `id, quantity, model, category, instance_parameters` | ingen direkte til bygningsdel |
| `category` (= Revit-type) | `id, name, vendor_id (Revit type-id), model_id, component_id, parent_id` | `component_id` peger på bygningsdelen |
| `component` (bygningsdel) | `classificationcode`, `classificationserial`, opbygning, fag, entreprise, måleenhed … | serien adskiller **bygningsdele** af samme klassifikation (fx to vægopbygninger), ikke elementer |

Konsekvens: NBS har **ikke** et koncept for "ét løbenummer pr. element" — 96
identiske vægge i Revit bliver korrekt 96 instanser under **én** bygningsdel.
"Type and Instance" i det officielle addin betyder at et *element* kan pege på
en *anden eksisterende* bygningsdel end sin type — det opretter ikke nye
bygningsdele.

**1:1-kobling Revit ↔ NBS** er bevist på Revit-elementets `UniqueId`, gemt i
NBS' interne tabel `Model-Instances.vendor_id` (server-side, ikke i Revit-modellen).
Verificeret med et kontrolleret eksperiment (én væg fik ændret areal, kun den
tilsvarende instans ændrede sig i NBS; 96/96 id'er stabile over tre
synkroniseringer). Se `docs/archive/2026-09-09-nbs/nbs-instance-link-evidence-2026-09-09.md`
for det fulde bevis.

`NBS Instance Manual Tag` (Revit-parameter, GUID `e60844a6-…`) er det eneste
instansfelt addin'et ikke selv overskriver, men addin'et **uploader det ikke**
til NBS — NBS' instansrække har intet fritekstfelt ud over `name`, som addin'et
sætter til typenavnet. Der er derfor ingen måde at give 96 vægge hver sit synlige
navn i NBS i dag.

## Rettede fejl (med commit, hvor de er landet)

1. **Ruter kun på v1, ikke v2** (`70f9b23`, `162e358`, `52b7250`): `POST
   /projects/{id}/component`, `/sheet` og `/quantities` findes kun under
   `/api/v1` — dokumentationen lister dem forkert som v2. `useV1: true` sat i
   `ComponentService`/`SheetService`/`QuantityService`.
2. **JSON-datoer ødelagt af Newtonsoft-parsing** (`10d7d0f`): ISO-datostrenge
   blev læst som `DateTime` og skrevet tilbage i US-format, hvilket fik senere
   kontroltjek til at fejle.
3. **Fejlsvar uden request-id** (`10d7d0f`): serveren tolkede visse fejl som
   timeout i stedet for at vise fejlteksten.
4. **NBS Date-ping-pong** (`1c8a42b`): vores sync skrev bygningsdelens
   `updated_at` (ISO/UTC) oven på addin'ets eget tidsstempelformat, som addin'et
   så overskrev igen ved næste Sync Now. Nu skrives feltet kun i addin'ets
   format og kun når det er tomt/ulæseligt/ældre.
5. **Native Sync Now fejlede på `MCP - test.rvt`**: manglende projektparametre
   `NBS Override`/`NBS Project Date` (kun 11 af 13 kernefelter var provisioneret).
   Rettet, installeret og live-verificeret 2026-09-09 03:38 mod projekt 10668
   (50 vægge). Se `docs/archive/2026-09-09-nbs/nbs-native-sync-repair-2026-09-09.md`.
6. **`classificationcode` med indlejret serienummer** — se status-afsnittet
   ovenfor (ucommitted).

## Dokumenteret, ikke kode (referencetabeller)

- **`NBSLinkType`-koder** (projektparameter `NBS Override`, ikke dokumenteret af
  NBS): `0` = Type and Instance, `1` = Type Only, `2` = Instance Only (aldrig
  observeret live). Brugt i `plugin/Core/NbsNativeSettings.cs` og
  `server/src/integrations/nbs/ModelSettings.ts`. Se
  `docs/archive/2026-09-09-nbs/nbs-linktype-mapping-2026-09-09.md`.

## Ikke verificeret / åbne punkter

- **"Type and Instance" for komponent-oprettelse**: aldrig kørt live — kræver
  skrivning i `NBS Override` + `PostCommand`, som var blokeret for automatisk
  udførelse under testen. Datamodellen gør det usandsynligt at den opretter
  bygningsdele, men det er ikke bekræftet.
- **Serie-kollision ved hurtige på-hinanden-følgende oprettelser**: NBS gav
  identisk serie til fire komponenter oprettet med få sekunders mellemrum
  (både 10973 og 13365). Ingen kendt client-side afhjælpning ud over at
  oprette dem enkeltvis og kontrollere resultatet.
- **`setComponentExtraField`** (Pro-only ifølge dokumentation): 404 på både v1
  og v2 i test — måske findes ruten slet ikke på den afprøvede plan.
- Live post-genstart-røgtest af den permanent installerede native
  sync-reparation er endnu ikke kørt (kræver at Revit åbnes igen).

## Kilder

- [NBS API-dokumentation](https://support.nbsnordic.dk/article/75-api-dokumentation)
- [NBS-parametre i Revit](https://support.nbsnordic.dk/article/88-hvilke-parameter-opretter-nbs-nordic)
- [NBS Overblik over Settings](https://support.nbsnordic.dk/article/92-overblik-over-settings)
- [Fejl ved Sync Now](https://support.nbsnordic.dk/article/119-der-opstar-en-fejl-nar-man-prover-at-synkronisere)
- Rå evidens og fulde kommandoer: `docs/archive/2026-09-09-nbs/*.md`
