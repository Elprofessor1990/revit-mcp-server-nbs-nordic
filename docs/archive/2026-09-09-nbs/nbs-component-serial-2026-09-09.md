# Bygningsdele oprettet via API får ikke unikke serienumre (verificeret 2026-09-09)

Mål: ét løbenummer pr. væg (96 vægge) som selvstændige NBS-bygningsdele
`[L]%AD.001` … `.096`, koblet én til én med `explicitInstanceMapping`.

## Hvad NBS' API faktisk gør (projekt 10973, v1 `POST /projects/{id}/component`)

| Kald | Resultat |
|---|---|
| `{name:"MCP-testvæg", classificationcode:"[L]%AD"}` (kl. 02:38) | id 343153, serie **.003** |
| `{name:"MCP-testvæg 01".."03"}` samme kode, 5 sek. mellemrum | 343221–343223, alle serie **.004** |
| `{…, classificationserial:"005"}` eksplicit | 343224, serie **.004** (feltet ignoreres) |
| `{…, classificationcode:"[L]%AD.005"}` fuld kode | 200, tom body, **intet oprettet** |

Opdatering/sletning: `PATCH`/`PUT`/`DELETE` på `/projects/{id}/component/{cid}` og
`/components/{cid}` → 404 på v1 og v2. `POST /api/v2/projects/{id}/components/{cid}`
svarer `"success"` på enhver body (også tom) uden at ændre rækken; det er
formentlig ruten til ekstra felter, ikke en opdatering.

Konklusion: serien tildeles af NBS efter en intern regel, som API'et ikke
styrer, og duplikater kan kun rettes i NBS' web-UI. Den tidligere antagelse i
`NbsSchemas.ts` ("NBS tildeler næste ledige serie") var baseret på én enkelt
oprettelse og er nu rettet.

## Konsekvens for værktøjerne

- `nbs_create_component` er egnet til enkeltoprettelser, hvor brugeren bagefter
  kontrollerer serien i NBS' web. Den er ikke egnet til at generere en
  nummerserie.
- Nummerering .001–.050 pr. element er fortsat kun det officielle addins
  Sync Now. Alternativet uden NBS-skrivning er et løbenummer i en Revit-parameter
  (fx Mark), som ikke er en NBS-klassifikation.

## Oprydning

Testbygningsdelene 343221–343224 ("MCP-testvæg 01"–"04", alle .004) ligger i
projekt 10973 og skal rettes eller slettes manuelt i NBS' web-UI.
