# Udviklersløjfe med Revit Add-In Manager

Bruges til at rette og genkøre NBS-bridge-koden uden at genstarte Revit.
Add-In Manager: https://github.com/chuongmep/RevitAddInManager (Revit 2019–2027).

## Første gang

1. Installér Add-In Manager og start Revit 2027 med en testmodel.
2. Add-Ins → Add-In Manager (Manual Mode) → Load → vælg
   `plugin\bin\AddIn 2027 Debug R27\revit_mcp_plugin\RevitMCPPlugin.dll`.
3. Vælg kommandoen `revit_mcp_plugin.Core.NbsBridgeSmokeTest` → Run.

Kommandoen er ikke på ribbonen. Den kører `status` og et read-only `snapshot`
af `OST_Walls` gennem samme dispatcher som MCP-serveren
(`NbsProjectBridge.Run`) og viser resultatet som JSON i et vindue med Kopiér.
Rapporten gemmes også som `%TEMP%\revit-mcp-nbs-smoke.json`.
Den skriver intet til modellen eller til NBS.

## Hver rettelse

```bash
dotnet build plugin/RevitMCPPlugin.csproj -c "Debug R27" -p:SkipAddinCopy=true
```

`SkipAddinCopy=true` springer kopieringen til Revit's Addins-mappe over, som
ellers fejler, mens Revit holder de deployede DLL'er låst. Tryk derefter F5 i
Add-In Manager og kør kommandoen igen.

Skift kategori ved at ændre `Category` i `plugin/Core/NbsBridgeSmokeTest.cs`.

## Hvad der stadig kræver genstart af Revit

Ribbon, TCP-serveren (SocketService), ExternalEvent-registrering og statisk
tilstand i IExternalApplication. Efter sådanne ændringer: luk Revit, byg uden
`SkipAddinCopy`, start Revit.

## Kendt begrænsning: Settings-vinduet fejler, mens DLL'en er indlæst i Add-In Manager

Når Add-In Manager har indlæst `RevitMCPPlugin.dll`, findes assemblyen to gange i
Revit: den, Revit indlæste ved opstart (ribbon, socket), og Add-In Managers kopi.
WPF slår XAML-ressourcer op efter assembly-navn og kan så ramme den forkerte kopi.
Symptom ved klik på ribbonens Settings:

    The component 'revit_mcp_plugin.UI.SettingsWindow' does not have a resource
    identified by the URI '/RevitMCPPlugin;component/ui/settingswindow.xaml'.

Afhjælpning: tryk **Remove** på DLL'en i Add-In Manager, før ribbonens Settings
eller MCP Panel bruges. Hjælper det ikke, gem modellen og genstart Revit.
Smoke-testen selv bygger sit vindue i kode og rammes ikke.
