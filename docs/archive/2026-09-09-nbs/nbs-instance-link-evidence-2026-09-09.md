# Bevis: NBS Sync Now kobler Revit-elementer 1:1 til NBS-instanser (2026-09-09)

Spørgsmål: Er identiske `.003`/`343153` på alle 96 vægge en fejl, findes der en
1:1-relation mellem Revit ElementId og NBS instans-id, hvor gemmer NBS-addin'et
koblingen, og virker Sync Now korrekt?

Svar: Ikke en fejl. 1:1 findes og er bevist. Koblingen gemmes i NBS' database,
ikke i Revit. Sync Now virker korrekt.

## Evidens 1: NBS' data efter Sync Now (Type and Instance)

`GET /api/v2/projects/10973/instances`, model 10156 "Project1":

- 96 instanser, id 57491588–57491683 (sammenhængende, oprettelsesrækkefølge).
- Id'erne er **identiske** over alle synkroniseringer kl. 05:00, 10:57, 11:12
  (Type and Instance) og 11:21. Tre gange 96 af 96 bevaret.
- Kategori "Generic - 200mm": `vendor_id` 441451 (Revit type-id),
  `vendor_id_secondary` = typens UniqueId, `component_id` 343153.
- Instansen selv har felterne `id, quantity, model, category, instance_parameters`
  (Area, Volume, Length, Unconnected Height, Base/Top Offset, Base/Top
  Extension Distance). Ingen bygningsdel og ingen synlige Revit-id'er.

## Evidens 2: kontrolleret eksperiment

Væg 1674273 (nr. 5 sorteret efter ElementId) fik højde 6,0 → 5,0 m, så arealet
blev 10,0 m² og unikt blandt de 96. Brugeren kørte Sync Now (NBSSyncModelDate
11:21:26, NBS-model synced 11:21:23, batch 6aa12513a01ac).

Resultat i NBS: **kun** instans 57491592 (nr. 5 sorteret efter id) ændrede sig:
Area 12,0 → 10,0, Unconnected Height 5, quantity 22,4 → 19,0. Alle 96 id'er
uændrede. Før eksperimentet var arealsekvensen (12,6/12,0/11,4 gentaget) også
identisk i alle 96 positioner efter ElementId og efter instans-id.

Konklusion: NBS instans-id ↔ Revit-element er 1:1 og stabil; rækkefølgen følger
ElementId. Væggen er sat tilbage til 6,0 m bagefter (NBS viser 10,0 indtil næste
Sync Now).

## Evidens 3: hvor koblingen gemmes

- Addin'ets DLL (NBSNordicRevitTools.dll 1.6.0) sender til ruten
  `/model/revit/job` et JSON med bl.a. `model`, `elementid`, `uniqueID`,
  `typeID`, `Parameters`, `Quantities`, `JobID`, `ProjectID`. Uploadet går via
  en separat tjeneste (host i DLL'en: `web.mangofield-…azurecontainerapps.io`).
- I Revit findes intet ud over de delte parametre fra
  `NBSNordicSharedParameters.txt`: ingen extensible-storage-schema fra NBS (kun
  ADSK og COM.PRODLIB), ingen DataStorage-elementer med NBS-data. Addin'et skrev
  ved Sync Now kun `NBS Override` (NBSSyncModelDate) og datofelter.
- NBS' offentlige API eksponerer ikke instansens Revit-id'er. Prøvet uden held:
  `/instances/{id}`, `/instance/{id}`, `/models`, `/models/{id}`,
  `/models/{id}/instances`, `/categories`, `/categories/{id}` (404 på v1 og v2)
  samt query-parametre (ignoreres).

Koblingen element ↔ instans lever altså server-side i NBS, nøglet på
`elementid`/`uniqueID`, som addin'et sender. Kategoriens `vendor_id` viser
samme mønster for typen.

## Evidens 4: hvad addin'et skriver i Revit ved Sync Now

| Felt | Hvornår | Format |
|---|---|---|
| `NBS Override`: NBSSyncModelDate | hver Sync Now | `yyyy-MM-dd HH:mm:ss` lokal |
| `NBS Date` (type) | skrevet 10:57:48 ved første sync efter kobling; ikke rørt 11:12 og 11:21 | samme |
| `NBS Instance Date` | kun på den ændrede væg 1674273: 11:21:26; de 95 andre urørte | samme |
| Instansfelter Id/kode/navn | urørte (vores værdier `343153` / `[L]%AD.003` blev stående) | – |

Datoen er addin'ets tidsstempel for, hvornår elementets NBS-data sidst blev
skrevet, ikke bygningsdelens `updated_at`. Vores planner (commit 1c8a42b) lader
et nyere addin-tidsstempel stå.

## Konklusion

- 96 × `343153`/`[L]%AD.003` er korrekt: alle vægge er samme bygningsdel.
  Serien identificerer bygningsdelen; instanserne identificeres af NBS internt.
- Sync Now virker: model, kategori→bygningsdel og 96 instanser med mængder er i
  NBS, og ændringer i Revit rammer den rigtige instans.
- "Type and Instance" ændrede intet i NBS' struktur; det giver kun mulighed for
  at pege et element på en anden eksisterende bygningsdel via
  `NBS Component Instance Id`.
- Der er intet at rette i vores kode for dette. Ingen kodeændringer i dette
  commit.

## Tillæg: direkte bevis fra NBS' eksport, og test af unikke navne (kl. 11:41)

### Instanskoblingen ligger i NBS' tabel Model-Instances, nøglet på Revit UniqueId

`GET /api/v2/export-backup/10973` er et zip-arkiv (central directory-offset er
ugyldigt for standardværktøjer; local headers kan inflates manuelt) med bl.a.
`csv/Model-Instances.csv` og `csv/Model-Categories.csv`, som det offentlige
instans-endpoint ikke viser:

| Tabel | Kolonner |
|---|---|
| Model-Instances | id, **vendor_id**, name, category_id, **component_id**, created_at, updated_at, deleted_at, last_batch_id |
| Model-Categories | id, model_id, parent_id, component_id, name, …, vendor_id, vendor_id_secondary |

For Project1 (model 10156): 96 rækker, `vendor_id` = Revit-elementets
**UniqueId**, `name` = typenavnet "Generic - 200mm", `component_id` = NULL
(koblingen ligger på kategorien 2169262 med component_id 343153; kategorien
"Walls" 2169261 har vendor_id −2000011 = BuiltInCategory.OST_Walls).

Match mod Revit: 96 af 96 UniqueId'er fundet, 0 umatchede, og rækkefølgen efter
ElementId er identisk med rækkefølgen efter NBS instans-id i alle 96
positioner. Væg 1674273 (…-00198c21) ↔ instans 57491592, som forudsagt.

Kolonnen `component_id` pr. instans findes altså i NBS' skema: det er den,
"Type and Instance" kan udfylde, når et element kobles til en anden bygningsdel
end sin type.

### Unikke navne pr. væg: NBS Instance Manual Tag uploades ikke

Feltvalg: addin'ets parameterfil grupperer felterne i "# Instance Parameters"
(skrives af addin'et fra NBS: Tag, Tender, Contract, GWP …) og
"# Instance Parameters Manual" (brugerens egne: Manual Doc Link, Manual Doc
Name, **Manual Tag**). Det eneste instansnavnefelt, addin'et ikke selv
overskriver, er `NBS Instance Manual Tag` (TEXT, GUID e60844a6-…).

| Trin | Revit | NBS |
|---|---|---|
| Før | feltet ikke bundet | Model-Instances.name = "Generic - 200mm" × 96 |
| Skrivning | bundet til Walls fra addin'ets fil; MCP-Væg-001 … 096 efter ElementId; kode `[L]%AD.003` og id 343153 uændrede | – |
| Sync Now 11:41:56 | de 96 navne står urørt; NBSSyncModelDate 11:41:58 | name uændret, intet nyt felt i instanser, bygningsdel 343153 og extra_fields uændrede, "MCP-Væg" findes ikke i eksporten |
| Tilbagerulning | værdier slettet, binding fjernet; kode og id fortsat uændrede; kun de 5 oprindelige instansfelter bundet | – |

Konklusion: 1:1-koblingen er direkte bevist på UniqueId. Et unikt navn pr. væg
kan holdes i Revit i `NBS Instance Manual Tag`, men addin'et sender det ikke
til NBS, og NBS' instansrække har intet fritekstfelt ud over `name`, som
addin'et sætter til typenavnet. Ingen kodeændringer.
