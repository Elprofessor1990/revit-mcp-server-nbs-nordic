# Kom godt i gang med Revit MCP + NBS Nordic

Denne guide gælder vores NBS-udvidelse. Den seneste opdatering er bygget og testet afgrænset i Revit 2027. Andre versionsmål og samtlige værktøjer er ikke dermed fuldt testet.

## Hvad forbinder vi?

Der er tre ting at kontrollere hver for sig:

1. **AI-klient → MCP-server:** Klienten starter vores lokale `server/build/index.js`.
2. **MCP-server → Revit:** Pluginet giver adgang til den aktive model gennem en lokal forbindelse.
3. **MCP-server → NBS:** Din NBS-nøgle giver adgang til projekter. Den enkelte RVT-fil kobles til ét valgt projekt.

At AI'en kan se Revit betyder ikke automatisk, at modellen er koblet til NBS. Automatisk opstart af forbindelsen er heller ikke automatisk datasynkronisering.

## Før du starter

- Brug en testmodel eller en kopi af dit arbejde.
- Brug Revit-plugin og server fra **dette repository**. Den gamle `npx -y mcp-server-for-revit`-kommando er ikke en verificeret vej til vores NBS-version.
- Installationen kræver kompilerede DLL'er, afhængigheder og manifester. [README](../README.md#1-install-the-revit-plugin) forklarer forskellen mellem førstegangsinstallation og opdatering.
- Hav NBS' officielle Revit-addin installeret, hvis du vil klargøre NBS-felter og bruge NBS' egen Sync Now.
- Du skal bruge en NBS API-nøgle med adgang til det ønskede projekt. En Anthropic-nøgle er kun nødvendig til den valgfrie chat inde i Revit, ikke til en ekstern MCP-klient.

## 1. Tilslut din AI-klient

Følg [MCP-opsætningen i README](../README.md#2-configure-the-mcp-server) for Codex, Claude Code eller Claude Desktop. Eksemplerne bruger en udskiftelig lokal sti og indeholder ingen API-nøgler.

Genstart klientens MCP-forbindelse, når opsætningen eller serveren er ændret. Bed derefter om:

> Kør get_connection_status. Vis den aktive Revit-model, NBS-forbindelsen og eventuelle manglende felter. Ændr ingenting.

## 2. Åbn og gem Revit-modellen

Forbindelsen starter automatisk som standard. Under **Settings → Forbindelse** kan du ændre “Start forbindelsen automatisk, når Revit åbner”.

**Revit MCP Switch** skifter mellem tændt og slukket. Klik ikke blindt på den ved hver opstart: hvis forbindelsen allerede kører, slukker du den.

**MCP Panel** er den valgfrie indbyggede chat. Du behøver ikke åbne den for at bruge Codex eller en anden ekstern klient.

## 3. Vælg NBS-projektet

I **MCP Settings → NBS Nordic**:

1. Indtast NBS API-nøglen.
2. Tryk **Forbind NBS og hent projekter**.
3. Vælg det rigtige test-/undervisningsprojekt.
4. Tryk **Forbind projekt og klargør NBS-felter**.
5. Gem RVT-filen, og kontrollér status igen.

Projektkoblingen gemmes i modellen. Nøglen gemmes lokalt i `%USERPROFILE%\.mcp-revit\nbs-config.json`; den fil skal ikke i Git, afleveringer eller delte mapper.

Opsætningen klargør 13 kernefelter fra NBS' officielle parameterdefinitioner. Den bevarer eksisterende native indstillinger og klargør blandt andet `NBS Override` og `NBS Project Date`. Den opretter ikke automatisk bygningsdele i NBS.

## 4. Vælg hvad der skal kobles

| Valg | Betydning |
|---|---|
| Type Only | NBS-data på Revit-typen; ingen skrivning til instansfelter |
| Instance Only | NBS-data på det enkelte element; elementer af samme type kan have hver sin kobling |
| Type and Instance | Begge niveauer; eksisterende selvstændige instanskoblinger bevares |

Start med en prøvevisning:

> Find NBS-bygningsdele, som kunne passe til mine vægge. Vis en dry run med Type and Instance, og forklar tvetydige matches. Skriv ikke noget endnu.

Kontrollér model, projekt, bygningsdele og berørte elementer. Bed først derefter om at anvende de konkrete koblinger. Værktøjet `sync_revit_types_to_nbs` skal have et `linkMode`; `dryRun: true` viser planen uden parameterændringer.

## 5. MCP-sync eller NBS Sync Now?

**MCP-kobling** læser NBS-data og skriver de understøttede Revit-parametre. Det er ikke en fuld tovejssynkronisering.

**NBS' egen Sync Now** er en separat funktion i NBS-fanen med NBS' egne indstillinger. Den kan uploade modeldata. Aftal projekt og omfang, før du starter en upload. MCP's særskilte mængde- og schedule-værktøjer uploader også data og skal bruges bevidst.

Ingen af disse dataskrivninger sættes automatisk i gang, blot fordi MCP-forbindelsen starter.

## Test i et nyt projekt

- [ ] Gem en ny test-RVT med et tydeligt navn.
- [ ] Kontrollér, at AI'en ser netop denne model.
- [ ] Vælg det aftalte NBS-testprojekt og klargør felterne.
- [ ] Kontrollér korrekt projekt-id, ingen manglende kernefelter og klar native indstillingstilstand.
- [ ] Tilføj et enkelt testelement, hvis modellen er tom. Tomme NBS-elementfelter er forventelige før kobling.
- [ ] Kør en dry run; kontrollér at den ikke ændrer modellen.
- [ ] Hvis en passende bygningsdel findes, godkend en afgrænset kobling og læs værdierne tilbage.
- [ ] Kør samme dry run igen; identiske data bør ikke give nye ændringer.
- [ ] Godkend eventuelt en native Sync Now separat, og verificér resultatet i både Revit og NBS.

**Status:** 19 NBS-tests og 10 native-settings-tests består. Native Sync Now blev testet i en repareret eksisterende model; en fuld gennemgang af en ny model efter den permanente installation afventer. Listen ovenfor er en testplan, ikke en påstand om allerede beståede tests.

## Navngivning og klassifikation

CCI-opslaget er baseret på Region Syddanmarks liste fra 12. juli 2023. Det er en bestemt reference, ikke et frit løbenummersystem eller en regel, som automatisk gælder alle NBS-projekter.

| Oplysning | Eksempel |
|---|---|
| Hovedtype fra referencen | `[L]%AD230` — Skillevæg, Skeletkonstruktion |
| Beskrivende typenavn, et lokalt forslag | `Skillevæg – Gips – 150 mm` |
| Individuelt element-ID, et lokalt forslag | `V-001` |

Hovedtype 230 betyder ikke “væg nummer 230”. NBS-projektets klassifikationssystem og separator skal kontrolleres, før en kode bruges. Referencens kodeformat må ikke uden videre omsættes til en ny NBS-komponent.

Vi har en simpel CCI-søgning. En visuel navneguide, modelkontrol og øvelser for studerende er foreslået, men endnu ikke bygget. Component-oprettelse via API virker (ruten findes kun under `/api/v1`), men klassifikationskoden skal være den bare gruppekode — sender man en fuld kode med serienummer, trunkerer NBS den stiltiende. Der må ikke loves automatisk oprettelse af 50 navngivne NBS-bygningsdele; se [nbs-integration-worklog.md](nbs-integration-worklog.md).

## Hvis noget fejler

- **Ingen Revit-forbindelse:** Kontrollér opstart, aktiv model og korrekt lokal MCP-serversti.
- **Ingen NBS-adgang:** Kontrollér nøgle og projektadgang i NBS-indstillingerne; del ikke nøglen i chat.
- **Felterne er tomme:** Kontrollér om elementet faktisk er koblet til en NBS-bygningsdel.
- **“Check the log for more information”:** Læs loggens konkrete fejl. Den tidligere fejl med manglende native indstillinger er [dokumenteret her](archive/2026-09-09-nbs/nbs-native-sync-repair-2026-09-09.md), men beskeden kan have andre årsager.
- **Opdatering:** Gem og luk Revit før DLL'er udskiftes. Genstart MCP-forbindelsen efter server-/schemaændringer.

Se [nbs-integration-worklog.md](nbs-integration-worklog.md) for den samlede, opdaterede status, eller [installations- og testhistorikken](archive/2026-09-09-nbs/nbs-update-2026-09-09.md) for den rå verifikation.
