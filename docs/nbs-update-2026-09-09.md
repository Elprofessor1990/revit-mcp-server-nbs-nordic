# Revit–NBS-opdatering · 9. september 2026

## Seneste status: native Sync Now repareret og installeret

Den 9. september kl. 03:38 blev kompatibilitetsrettelsen installeret permanent,
mens Revit var lukket. DLL/PDB er hashkontrolleret; backup ligger i
`artifacts/install-backup-20260909-033802-358/`. NBS' eget addin er ikke ændret.
Se [årsag, test og installation](nbs-native-sync-repair-2026-09-09.md).

Broen klargør nu 13 kernefelter (tidligere 11), herunder `NBS Override` og
`NBS Project Date`, og beskytter projektindstillinger mod elementsynkronisering.
19 NBS-tests og 10 native-settings-tests består; TypeScript og R27-build består.
Den tidligere live-test af NBS' egen Sync Now lykkedes mod projekt **4.semester**
(10668), model 10154, med 50 vægge og 20 øvrige elementer. En ny live-test efter
denne permanente installation afventer, at Revit åbnes.

Oprettelse af bygningsdele via det dokumenterede API gav fortsat HTTP 404 i de
afprøvede projekter. Væggene har derfor ikke fået `.001`–`.050`-koblinger.
Navneguiden for studerende er undersøgt og foreslået, men ikke implementeret.
Referencens hovedtypekoder må ikke forveksles med individuelle elementnumre.

De følgende afsnit er den tidligere installations- og testhistorik; projekt 10973
og optællingen på 11 felter beskriver de daværende tests, ikke den seneste status.

## Installeret

Revit 2027-plugin og den tilhørende Node-server er opdateret. Seks filer er
kopieret og SHA-256-kontrolleret. Kommandoindstillinger og commandset-DLL'er er
bevaret. Backup: `artifacts/install-backup-20260909-024139-791/`.

## Brug

1. Åbn Revit 2027 og modellen. MCP starter automatisk, medmindre automatisk
   opstart er slået fra under Forbindelse.
2. Åbn Settings → NBS Nordic. Indtast NBS-nøglen, og hent projektlisten.
3. Vælg projektet, og tryk **Forbind projekt og klargør NBS-felter**.
4. Gem RVT-filen. Projektvalget hører til modellen, ikke en global standard.
5. Genstart AI-klientens MCP-forbindelse, så den indlæser den nye server og dens
   tre nye værktøjer: `get_connection_status`, `nbs_connect_project`,
   `nbs_clone_project`.
6. Bed AI'en om en prøvevisning med `sync_revit_types_to_nbs` (`dryRun: true`),
   vælg `linkMode`: `typeOnly`, `instanceOnly` eller `typeAndInstance`,
   kontrollér koblingerne, og anvend derefter den ønskede synkronisering.

## Rettelse: koblingsniveauer og synkronisering på anmodning

De tre niveauer understøttes nu eksplicit i MCP-værktøjet. Type Only skriver
udelukkende typefelter; Instance Only skriver udelukkende instansfelter; Type
and Instance behandler de to koblinger hver for sig. En særskilt instanskobling
bliver ikke længere overskrevet med typens kobling. Valgfri, udtrykkelig
`inheritTypeForUnlinkedInstances` kan i kombineret tilstand kopiere en sikker
typekobling til helt ukoblede instanser, men aldrig til instanser med egne id'er
eller klassifikationskoder.

`explicitInstanceMapping` bruger Revit-elementets UniqueId som nøgle og et
verificeret NBS-bygningsdels-id som værdi. Det tillader forskellige koblinger
for elementer af samme Revit-type. En serie `.001`–`.050` kan kun kopieres som
NBS-klassifikationer, når de tilsvarende bygningsdele faktisk findes i NBS.
Værktøjet opfinder ikke klassifikationsnumre eller opretter bygningsdele.

NBS' officielle Settings-vindue styrer **NBS' eget addin**. MCP-valget er pr.
værktøjskald og ændrer ikke dette vindue. Denne MCP-synkronisering henter NBS-data
til Revit; den er ikke det officielle addins fulde tovejskørsel “Sync Now”.
Modelupload, mængdeeksport og native settings er ikke automatisk omfattet.
Der udføres ingen periodisk eller automatisk datasynkronisering.

En genstart af AI-klientens MCP-forbindelse er nødvendig for at indlæse den
ændrede værktøjsdefinition (`linkMode` er obligatorisk). Rettelsen kræver ikke
en ny Revit-DLL. Allerede oprettede, men tomme NBS-felter betyder ikke i sig selv,
at forbindelsen er defekt: projektkobling opretter felter, mens en særskilt
bygningsdelskobling bestemmer værdierne.

Grundlag: [NBS – Overblik over Settings](https://support.nbsnordic.dk/article/92-overblik-over-settings).

Rettelsen er installeret som server-only opdatering; backup ligger i
`artifacts/install-backup-20260909-025304-011/`. 19 regressionstests består.
Live-prøvevisning af alle tre tilstande mod `MCP - test.rvt` / projekt 10973
er gennemført: 50 vægge, ingen manglende NBS-felter, ingen planlagte ændringer,
da typen og instanserne endnu mangler bygningsdelskobling. Ingen modelværdier,
native NBS-indstillinger eller eksterne NBS-data blev ændret under disse tests.

NBS-nøglen gemmes lokalt i `%USERPROFILE%\.mcp-revit\nbs-config.json`, ikke i
modellen. Filen indeholder en hemmelighed og må ikke deles eller lægges i Git.
Serveren genlæser nøglen ved forespørgsler. Eksisterende miljøvariabel og den
gamle nøglefil bruges som fallback. Anthropic-nøglen er kun til den valgfrie,
indbyggede chat og er ikke nødvendig for en ekstern MCP-klient.

## Ændret adfærd

- Officielle NBS-parametre oprettes med NBS' installerede sharedparameter-fil.
- Model- og projektidentitet kontrolleres igen ved skrivehandlingen.
- Fuld klassifikation inklusive separator/løbenummer opdateres på typer og
  instanser. Allerede koblede typer og nye instanser medtages også.
- Tvetydige matches kræver en eksplicit kobling; `Mark` overskrives ikke.
- Parameterændringer sker i én Revit-transaktion med kontrol af de tidligere
  værdier. En gentaget synkronisering er uden ændringer, når data er ens.
- Kommandoindstillinger gemmer både til- og fravalg og bevarer øvrige settings.

## Verifikation og begrænsninger

- 11 automatiske tests bestået (synkroniseringsplan, model/projektkontrol,
  lokal TCP-test og mock af projektkopiering). Ingen NBS-projekter oprettet som test.
- TypeScript-typekontrol og serverbuild bestået; 151 værktøjer registreret.
- Revit 2027 Release-build bestået: 0 fejl og 4 advarsler fra eksisterende
  afhængigheder/den indbyggede chat.
- Indstillingssidens XAML er renderet og visuelt kontrolleret. Det er en
  UI-forhåndsvisning, ikke dokumentation for en live NBS-forbindelse.
- Livekontrol efter genstart: automatisk opstart på port 8080 bekræftet i loggen;
  ny MCP-server læser `MCP - test.rvt`, og NBS giver adgang til 19 projekter.
  Efter brugerens godkendelse blev `MCP - test.rvt` koblet til Ali Kadum (#10973).
  Genlæsning bekræftede projekt-id og alle 11 NBS-felter uden mangler.
  Prøvevisningen fandt 50 vægge af typen `Generic - 200mm` (type-id 441451),
  men ingen entydig NBS-kobling. Ingen CCI-værdier er derfor skrevet.
  Brugeren skal gemme RVT-filen for at bevare projektkoblingen og felterne.
- Nyt projekt oprettes som **kopi af et eksisterende projekt** via NBS' dokumenterede
  Pro-funktion. Oprettelse af et tomt projekt er ikke implementeret.
- En allerede tilknyttet model flyttes ikke automatisk til et andet NBS-projekt:
  eksisterende komponent-id'er kræver en særskilt, bevidst migrationsfunktion.
- Ændring af eksisterende bygningsdeles primære klassifikation på NBS-websiden
  er ikke implementeret uden en dokumenteret skrivefunktion i API'et.
- NBS' eget Revit-addins interne UI/session er ikke automatiseret. MCP opretter
  modelparametre og arbejder via NBS API; dette er ikke bevis for, at alle knapper
  i NBS' eget addin aktiveres.

## Kilder

- [NBS API-dokumentation](https://support.nbsnordic.dk/article/75-api-dokumentation)
- [NBS-parametre i Revit](https://support.nbsnordic.dk/article/88-hvilke-parameter-opretter-nbs-nordic)
- Obsidian-noten “MCP + NBS Nordic” er læst som projektgrundlag.

## Gendannelse

Luk Revit. Backupmappens filer har samme relative struktur som installationen
under `%APPDATA%\Autodesk\Revit\Addins\2027\revit_mcp_plugin`. Kopiér de seks
filer tilbage for at gendanne det tidligere installerede plugin/server-par.
Det ændrer ikke modeller, NBS-data eller kommandoindstillinger. Workspace-serveren
skal også bruge en tilsvarende version, hvis AI-klienten starter den direkte.
