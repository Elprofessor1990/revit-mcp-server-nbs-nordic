# Plan: samlet Revit–NBS-forbindelse og CCI i egenskaber

Dato: 2026-09-09. Undersøgt checkout: `793b0da`.
Status: løsningen er implementeret lokalt og dækket af 11 automatiske tests. Installation og livekontrol er beskrevet i `../archive/2026-09-09-nbs/nbs-update-2026-09-09.md`; samlet, opdateret status står i `../nbs-integration-worklog.md`. Analysen nedenfor er bevaret som beslutningsgrundlag; den beskriver også tilstanden før ændringerne.

## Det ønskede resultat

Brugeren opsætter forbindelsen én gang og vælger NBS-projekt for hver Revit-model. Forbindelsen starter og genoprettes automatisk. Herefter kan brugeren give AI'en en samlet opgave, eksempelvis: »Kobl disse vægge til den rigtige NBS-bygningsdel, og vis klassifikation, navn, dato og dokumentlink i egenskaberne.«

Det seneste skærmbillede præciserer, at visning på **instansen i Revit Properties** er et hovedkrav. En fremtidig ændring af bygningsdelens klassifikation på NBS-websiden er en særskilt handling og skal også understøttes, hvis en verificeret skriveadgang findes. At skrive et felt i Revit dokumenterer ikke, at NBS er blevet opdateret.

`Mark` kan være et individuelt elementnummer. Det må ikke automatisk sidestilles med NBS-bygningsdelens klassifikation og løbenummer. Mange Revit-instanser kan pege på den samme bygningsdel.

## Hvad der er bekræftet

| Område | Resultat og betydning |
| --- | --- |
| Samlet MCP-adgang | `revit-mcp-nbs` svarer både på Revit- og NBS-kald i denne Codex-task. Der behøves ikke en ny MCP-server for hver funktion. |
| NBS-adgang | Live `nbs_list_projects` returnerede 19 projekter. Standardprojektet er `10973`, »Ali Kadum«, med `CCI Bygningsdele R1`. Projektlisten indeholder også andre klassifikationssystemer. |
| Den aktuelle model | Live Revit-læsning viste `MCP - test.rvt`, Revit 2027, uden `NBS Project Id` og uden NBS-parameterbindinger. En stikprøve på en væg manglede også NBS-id og klassifikation. |
| Skærmbillederne | Det seneste billede viser `Project1` med udfyldte NBS-felter. Det er ikke samme dokumenttitel som det aktive dokument ved live-testen. Billedet dokumenterer det ønskede udseende, ikke tilstanden i den testede fil. |
| Manuel start | `Application.OnStartup` registrerer brugerfladen, men starter ikke socket-serveren. `MCPServiceConnection.Execute` starter/stopper ved klik. »Close Server« vises efter stop og er en uklar statusbesked. |
| Kommandoernes `false` | Nye fundne kommandoer får `Enabled = false` i indstillingsvisningen; derefter indlæses eventuelle gemte valg. Det beviser ikke, at alle valg nulstilles ved hver opstart. Den installerede registry har 129 poster uden et eksplicit enabled-felt; genstartsadfærden skal testes særskilt. Flere kommandoer virkede live. |
| NBS-indstillinger | »Configured« betyder blot, at en nøgle findes. Siden kontrollerer ikke API-adgang, projektadgang eller modelbindinger. Projektet angives som et råt id. |
| Projektvalg i serveren | `resolveProjectId` vælger eksplicit id eller global standard fra miljø/fil. Det læser ikke modellens `NBS Project Id`. |

Obsidian-noten »MCP + NBS Nordic« er gennemlæst som historik. Den indeholder senere korrektioner til tidligere testkonklusioner og en gammel opgaveliste til Codex. De afsnit er ikke nye instruktioner om at ændre opsætning, kontakte andre eller gentage skrivende tests.

## API-nøglerne, forklaret i brugerfladen

| Felt i dag | Faktisk formål | Forslag |
| --- | --- | --- |
| API Key / Anthropic | Driver den indbyggede Claude-chat i Revit. Den bruges ikke af den eksterne AI-klients MCP-forbindelse. | Flyt til »Avanceret → Indbygget chat (valgfri)«. |
| NBS Nordic API Key | Giver integrationen adgang til brugerens NBS-projekter og de tilladte API-handlinger. | Vis under »Forbind NBS Nordic«, med test og projektliste. |
| MCP-port | Lokal forbindelse mellem MCP-server og Revit-plugin. | Skjul i avancerede indstillinger; vis kun ved fejl. |

API-nøgle betyder her en adgangsnøgle til en bestemt tjeneste, ikke en generel kontakt til at tilslutte vilkårlige programmer.

## Misforståelser, som planen retter

**NBS-parametre kan oprettes af vores integration.** Obsidian-notens formulering om, at kun NBS' eget plugin kan oprette dem, er for kategorisk. NBS dokumenterer selv brug af `NBSNordicSharedParameters.txt` til egen oprettelse, og Revit API understøtter bindingerne. Den officielle fil findes i den lokale NBS-installation og indeholder GUID, datatype og øvrige definitionsegenskaber. Vores eksisterende `AddSharedParameterEventHandler` viser allerede mekanismen.

Det giver et konkret grundlag for at automatisere parameteroprettelsen. Det beviser ikke, at NBS' officielle plugin automatisk genkender alle interne forbindelsesindstillinger bagefter. Kompatibiliteten med deres »Sync Now«, dokumentlinks og modelregistrering skal testes særskilt. `NBS Override` må ikke udfyldes med gættede interne værdier.

**Det eksisterende sync-værktøj er ikke fuld tovejssynkronisering.** Det læser NBS-bygningsdele, matcher typer og skriver udvalgte værdier til Revit. Det ændrer ikke klassifikationen på en eksisterende NBS-bygningsdel og opretter ikke automatisk manglende bygningsdele.

**API-dokumentationen giver ikke en komplet skrivekontrakt.** Den dokumenterer oprettelse af bygningsdele, mængder, skemaer og ekstra felter, men ikke ændring af eksisterende bygningsdeles primære klassifikation eller oprettelse af et helt nyt projekt fra bunden. Dokumenteret projektkloning er noget andet. Vi kan ikke konkludere, at en udokumenteret mulighed er umulig, men den må afklares før den indgår som et lovet produktkrav.

## Prioriteret implementering

### 1. Én forståelig forbindelse

- Saml standardvisningen i »Forbindelse« og »NBS-projekt«, med »Avanceret« til porte, logs, kommandooversigt og indbygget chat.
- Vis separat status for Revit, NBS-login, valgt projekt, parameterbindinger og seneste verificerede synkronisering. Vis aktiv Revit-fil og NBS-projektnavn på samme sted.
- Tilføj en gemt indstilling for automatisk start efter førstegangsopsætningen. Initialisér på et gyldigt Revit UI-tidspunkt; undgå netværksventetid på UI-tråden. Genforbind efter afbrudt forbindelse.
- Erstat den blinde toggle og »Open/Close Server«-dialoger med tydelig »Forbundet«, »Venter på model«, »Afbrudt« og konkret fejlforklaring. Bevar en tydelig mulighed for at afbryde.
- Giv normale workflows et fornuftigt kommandosæt. Bevar eksisterende bevidst fravalgte kommandoer. Undersøg manglende registry-felter og migration frem for blot at ændre alle `false` til `true`.
- Vis den valgfri chat som ukonfigureret, hvis dens egen nøgle mangler; »MCP Online« må ikke få den indbyggede chat til at fremstå brugsklar.

Accept: genstart Revit og AI-klienten efter førstegangsopsætning; den gemte forbindelse virker, og status viser det rigtige dokument uden et manuelt tryk på Switch.

### 2. Forbind et eksisterende NBS-projekt én gang pr. model

- Genbrug den fungerende nøgle og hent en projektliste med navne og klassifikationssystemer. Lad brugeren vælge projekt, eventuelt gennem AI'en.
- Opret en samlet modeltilknytning, der validerer projektadgang, kontrollerer eksisterende bindinger, tilføjer manglende officielle NBS-parametre og gemmer NBS-projektets database-id i modellen.
- Brug originale GUID'er, korrekte datatyper og type-/instansbindinger. Bind projektfeltet til Project Information. Bevar eksisterende kategorier og værdier; gentaget tilknytning må ikke skabe dubletter.
- Genbrug den installerede definitionsfil. Hvis den mangler, skal opsætningen oplyse præcis hvad der mangler; brug ikke tilfældige GUID'er som erstatning. Eventuel distribution af filen med vores produkt afklares separat.
- Bevar Revit-brugerens valgte shared parameter-fil, hvis den midlertidigt skiftes under operationen.
- Brug modellens binding til almindelige modeloperationer. Et eksplicit andet projekt-id skal håndteres som et projektvalg eller en konflikt; global standard er kun et forslag for en ubundet model.
- Nøglen gemmes pr. bruger, ikke i RVT-filen. Saml læsning af indstillinger, så »gemt« også betyder, at den aktive server bruger dem. Eksisterende miljøvariable kan ellers overskygge en opdateret fil og kræve genstart af den proces, som læser dem.

Accept: i en ny testmodel kan én samlet tilknytning gøre modellen klar uden først at bruge NBS' Settings/Sync Now. Kør den igen uden dubletter, genåbn filen, og kontrollér at projektvalget følger modellen. Et andet åbent dokument må ikke arve det forkerte projekt.

### 3. Korrekt og gentagelig klassifikation i Revit

To konkrete fejl bør rettes før dette kaldes færdig synkronisering:

1. `sync_revit_types_to_nbs.ts:183–185` reducerer API-data til `classificationcode` og mister `classificationserial` og separator. De værdier, som skrives ved linje 267/278, er derfor kun kodegruppen. Live API-data viste fx komponent `257085` med `[L]%AD`, `001` og `.`: den fulde kode er `[L]%AD.001`. Brug API'ets faktiske felter til både matching og skrivning.
2. Linje 205–207 sorterer allerede id-linkede typer fra skrivningen. Derfor opdateres de ikke ved ændret navn/kode i NBS, og nye instanser af en linket type bliver ikke nødvendigvis udfyldt. Adskil »opret link« fra »opdatér et eksisterende link«.

Derudover:

- Synkronisér både type og alle relevante instanser, også nyligt placerede instanser. Brug kendte bygningsdels-id'er og projektkontrol; navnelighed alene skal være et forslag.
- Læs dokumentlinks fra verificerede API-data, når de er tilgængelige. Gæt ikke URL'er eller påstå, at en upubliceret beskrivelse har et offentligt link. Nuværende værktøj skriver ikke dokumentlinks.
- Skeln mellem NBS' ændringsdato og vores lokale tidspunkt for synkronisering. Giv dem korrekte labels.
- Håndtér instansafgrænsning og store modeller eksplicit. Nuværende grænser på typer og højst 1.000 instanser må ikke give en ubemærket delvis synkronisering.
- Gem modelidentitet sammen med typeidentitet og NBS-projekt i mappings. Numeriske Revit-element-id'er alene kan genbruges i forskellige modeller.
- Registrér først en gennemført mapping efter verificeret skrivning. I dag lægges mapping/log ind før Revit-skrivningen, og tællerne bygger på id-feltets succes frem for alle krævede felter.
- Læs nødvendige felter tilbage før rapporten siger »synkroniseret«. Rapportér delvise fejl og tillad kontrolleret genforsøg.
- Hold CCI-referencekatalog og NBS-projektets løbenumre adskilt. Det lokale katalog er fra Region Syddanmark 2023; et foreslået katalognummer må ikke uden verifikation blive et nyt løbenummer i et NBS-projekt.

Accept: verificér fuld kode, navn, id og tilgængeligt link på instansen i Properties; gentaget sync er uden unødige ændringer; ændringer i NBS og nye Revit-instanser slår igennem. Afprøv tvetydige matches, fejl under skrivning og en model over nuværende antalgrænse.

### 4. Ét AI-workflow og afklaring af skrivning til NBS

Foreslåede samlede værktøjer: `get_connection_status`, `connect_nbs_project` og `sync_nbs_classification`. Navnene er forslag; værktøjerne findes ikke endnu. De skal genbruge eksisterende funktioner og håndtere rækkefølgen, så brugeren ikke skal kende de tekniske trin.

Et workflow skal kunne læse den aktuelle model, vælge kendte bygningsdele, vise eventuelle tvetydigheder, udføre den bestilte handling og verificere resultatet samlet. Et klart bestilt arbejde behøver ikke separate brugerklik for hvert teknisk deltrin. Projektkonflikter og uklare matches kræver afklaring.

For ændring af en eksisterende bygningsdels primære CCI-kode skal næste undersøgelse være NBS' understøttede skrivekontrakt: endpoint, felter, rettigheder, løbenummerhåndtering og efterfølgende GET-verifikation. Kontakt til NBS er ikke sendt som del af denne analyse. Hvis der ikke findes en understøttet API-vej, skal et eventuelt browserworkflow beskrives som en separat løsning, ikke skjules bag et løfte om ren MCP/API-synkronisering. En ekstra-felt-opdatering er ikke en ændring af den primære CCI-kode.

## Leverancer og testgrænse

Første leverance bør omfatte forbindelsesstatus, automatisk start, projektdropdown og modeltilknytning. Anden leverance retter og verificerer klassifikationssynkroniseringen. En fuld NBS-skrivefunktion kommer efter afklaring af API-kontrakten.

Kodearbejde er næste fase. Denne undersøgelse har kun læst model-/NBS-data. Der er ikke udført oprettelse, parameterbinding, klassifikationsændring, deployment eller ændring af brugerens Obsidian-note.

Ved implementering skal TypeScript types kontrolleres, det faktiske serverbundle bygges, og pluginet bygges mod Revit 2027. Det nuværende buildscript indeholder deployment; planlæg derfor build og installation bevidst, og verificér den version den aktive klient indlæser. Test modelændringer i en særskilt testmodel. Kontrollér særskilt samspil med NBS' officielle Sync Now, så vores værdier ikke uventet overskrives.

## Kilder

- [NBS: API-dokumentation, opdateret 13. april 2026](https://support.nbsnordic.dk/article/75-api-dokumentation).
- [NBS: parametre og officiel shared parameter-fil](https://support.nbsnordic.dk/article/88-hvilke-parameter-opretter-nbs-nordic).
- [Autodesk: Shared Parameters og binding via Revit API](https://help.autodesk.com/cloudhelp/2024/ENU/Revit-API/files/Revit_API_Developers_Guide/Basic_Interaction_with_Revit_Elements/Parameters/Revit_API_Revit_API_Developers_Guide_Basic_Interaction_with_Revit_Elements_Parameters_Shared_Parameters_html.html).
- Lokal Obsidian-note: `MCP + NBS Nordic.md`, gennemlæst inklusive senere korrektioner.
- Lokal NBS-fil: `%AppData%/NBSNordic/NBSNordicRevitTools/2027/Resources/NBSNordicSharedParameters.txt`.
- Kode: `plugin/Core/Application.cs:16`, `plugin/Core/MCPServiceConnection.cs:11`, `plugin/Configuration/ServiceSettings.cs`, `plugin/UI/CommandSetSettingsPage.xaml.cs:204`, `plugin/UI/NbsApiKeySettingsPage.xaml.cs:29`, `plugin/UI/ApiKeySettingsPage.xaml:19`, `server/src/integrations/nbs/NbsConfig.ts:65`, `server/src/tools/sync_revit_types_to_nbs.ts:96`, `commandset/Services/AddSharedParameterEventHandler.cs:34`.
- Read-only live-kald: `nbs_list_projects`, `nbs_get_project`, `nbs_list_components`, `get_project_info` og afgrænsede C#-læsekald med `transactionMode: none`.
