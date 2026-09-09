# Root cause: hvorfor Sync Now ikke giver ét NBS-nummer pr. væg (2026-09-09)

## Forventning vs. NBS' faktiske datamodel

Forventningen var, at NBS' Sync Now (Type and Instance) ville give de 96 vægge i
Project1 hver sin bygningsdel `[L]%AD.001` … `.096`. Det sker ikke, og det er
ikke en fejl i addin'et, i vores plugin eller i serveren. Det er sådan NBS er
bygget. Evidens fra `GET /api/v2/projects/10973/instances` (253 instanser i 4
modeller):

| Objekt | Felter | Kobling til bygningsdel |
|---|---|---|
| instance | `id, quantity, model, category, instance_parameters` | **ingen** |
| category (= Revit-type) | `id, name, vendor_id (Revit type-id), model_id, component_id, parent_id` | `component_id` |
| component (bygningsdel) | `classificationcode`, `classificationserial`, opbygning, fag, entreprise, måleenhed … | serien identificerer bygningsdelen |

Alle fire modeller følger dette: `Generic - 200mm` (vendor 441451) er én
kategori pr. model med ét `component_id` (257085, null, null, 343153), og de
24/50/96 instanser under den bærer kun mængder (Area, Volume, Length …).

Konsekvens: et serienummer (.001, .002 …) adskiller **bygningsdele** af samme
klassifikation, fx to forskellige vægopbygninger. Det er ikke et løbenummer for
elementer. "Type and Instance" i addin'et betyder, at et element i Revit kan
kobles til en *anden eksisterende* bygningsdel end sin type (felterne
`NBS Component Instance Id` m.fl. findes i addin'ets DLL). Det opretter ikke
bygningsdele.

## Hvad Sync Now faktisk gjorde (kl. 10:57:45–48)

- Uploadede modellen som NBS-model 10156 "Project1" med 96 instanser og mængder.
- Satte kategoriens `component_id` = 343153 (MCP-testvæg), hentet fra typens
  `NBS Component Type Id` i Revit.
- Skrev `NBSSyncModelDate=2026-09-09 10:57:48` i `NBS Override` og overskrev
  typens `NBS Date` med sit **synkroniseringstidspunkt** i formatet
  `yyyy-MM-dd HH:mm:ss` (lokal tid).
- Oprettede ingen bygningsdele. Instansfelterne (.003 på alle 96) blev ikke rørt.

## Fejl, vi fandt og rettede undervejs (alle med commit)

1. **JSON-datoer blev omdannet i pluginet** (`RpcJson`, commit 10d7d0f): Newtonsoft
   parsede ISO-strenge til DateTime, så "NBS Date" blev skrevet som
   "09/09/2026 02:38:14", og alle senere skrivninger fejlede kontroltjekket.
2. **Fejlsvar uden request-id** (samme commit): serveren så timeout i stedet for
   fejlteksten.
3. **NBS Date ping-pong** (denne commit): vores sync skrev bygningsdelens
   `updated_at` (ISO/UTC) tilbage oven på addin'ets tidsstempel, og addin'et
   skrev sit igen ved næste Sync Now. Nu skrives feltet i addin'ets format og
   kun når det er tomt, ulæseligt eller ældre end bygningsdelens ændring i NBS.
   Verificeret mod den levende model: 0 skrivninger i både Type Only og
   Type and Instance efter addin'ets Sync Now.
4. **Preview-svaret fyldte 75 kB** for 96 identiske instanser: instanser, der
   blot bærer deres eksisterende id, rapporteres nu som optælling
   (`instanceSummary`), og kun afvigende instanser listes.
5. **Værktøjsbeskrivelser** lovede/afviste "allocate .001–.050 numbers". Teksten
   beskriver nu NBS' datamodel korrekt.
6. **Serienumre via API** (commit 0d779b0): kan hverken sættes eller rettes;
   NBS gav fire oprettelser samme serie .004. Skal ryddes op i NBS' web.

## End-to-end-resultat på de 96 vægge

- Revit: typen og alle 96 instanser har id 343153, kode `[L]%AD.003`, navn
  MCP-testvæg. Datoer i addin'ets format.
- NBS: model 10156 med 96 instanser under kategorien Generic - 200mm, koblet til
  343153. Mængder pr. instans er uploadet.
- Vores sync: preview = no-op i begge koblingstyper efter Sync Now. Ingen
  ping-pong.

## Det, der ikke er verificeret

Sync Now med Link Type "Type and Instance" (NBSLinkType=0) blev ikke kørt af os:
den kræver skrivning i `NBS Override` og PostCommand, som blev blokeret for
automatisk udførelse. Datamodellen ovenfor gør det usandsynligt, at den opretter
bygningsdele, men det bør bekræftes manuelt: sæt Link Type i NBS' dialog, Save,
Sync Now, og læs `nbs_list_components` og væggenes instansfelter igen.

## Hvis man vil have ét nummer pr. væg alligevel

Det er uden for NBS' model. Alternativerne er (a) et løbenummer i en
Revit-parameter (fx Mark), eller (b) 96 bygningsdele oprettet i NBS' web-UI
eller via Excel-import, hvor serien styres af NBS, og derefter
`explicitInstanceMapping` pr. væg. (b) giver 96 specifikationsposter med hver sin
mængde, hvilket sjældent er ønsket.
