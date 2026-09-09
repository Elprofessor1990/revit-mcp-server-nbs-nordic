$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase
$repoPath = Split-Path $PSScriptRoot -Parent
[xml]$layout = Get-Content -Raw -Encoding UTF8 (Join-Path $repoPath 'plugin/UI/NbsApiKeySettingsPage.xaml')
$layout.DocumentElement.RemoveAttribute('Class', 'http://schemas.microsoft.com/winfx/2006/xaml')
foreach ($element in $layout.SelectNodes('//*')) {
    foreach ($attribute in @($element.Attributes)) {
        if ($attribute.LocalName -in @('Loaded', 'PasswordChanged', 'Click', 'MouseLeftButtonUp', 'SelectionChanged')) {
            [void]$element.RemoveAttributeNode($attribute)
        }
    }
}
$reader = [System.Xml.XmlNodeReader]::new($layout)
$page = [Windows.Markup.XamlReader]::Load($reader)
$page.FindName('StatusText').Text = 'NBS forbundet — 10 aktive projekter. Nøglen er gemt til din AI.'
$page.FindName('ModelText').Text = "Revit: MCP - test`nKoblet til NBS-projekt #10973"
$page.FindName('ApiKeyPasswordBox').Password = 'preview-only'
$projects = $page.FindName('ProjectsComboBox')
$projects.DisplayMemberPath = ''
[void]$projects.Items.Add('Ali Kadum — CCI Bygningsdele R1 (#10973)')
$projects.SelectedIndex = 0
$page.FindName('ProjectDetailsText').Text = 'Klassifikationssystem: CCI Bygningsdele R1'
$page.FindName('ConnectButton').IsEnabled = $true
$page.Width = 700
$page.Height = 600
$page.Measure([Windows.Size]::new(700, 600))
$page.Arrange([Windows.Rect]::new(0, 0, 700, 600))
$page.UpdateLayout()
$bitmap = [Windows.Media.Imaging.RenderTargetBitmap]::new(700, 600, 96, 96, [Windows.Media.PixelFormats]::Pbgra32)
$bitmap.Render($page)
$outputDir = Join-Path $repoPath 'artifacts'
[void](New-Item -ItemType Directory -Path $outputDir -Force)
$target = Join-Path $outputDir 'nbs-settings-preview.png'
$stream = [IO.File]::Create($target)
try {
    $encoder = [Windows.Media.Imaging.PngBitmapEncoder]::new()
    $encoder.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
    $encoder.Save($stream)
} finally { $stream.Dispose() }
Write-Output $target
