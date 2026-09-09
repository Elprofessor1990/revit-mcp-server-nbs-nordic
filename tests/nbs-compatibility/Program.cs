using System;
using revit_mcp_plugin.Core;

static void Assert(bool condition, string message)
{
    if (!condition) throw new Exception(message);
    Console.WriteLine("PASS: " + message);
}

var initialized = NbsNativeSettings.EnsureInitialized(null);
Assert(initialized.StartsWith("NBSOverride=0,"), "Missing native state initializes the overwrite object without enabling parameter overrides");
Assert(initialized.Contains("NBSLinkType=1"), "New native settings use the vendor's Type Only default");
Assert(NbsNativeSettings.EnsureInitialized(initialized) == initialized, "Repeated repair is a no-op");
var existing = initialized.Replace("NBSLinkType=1", "NBSLinkType=0").Replace("NBSSyncSch=0", "NBSSyncSch=1") + ",FutureOption=keep=all";
Assert(NbsNativeSettings.EnsureInitialized(existing) == existing, "User choices and unknown vendor options are preserved byte-for-byte");
var partial = NbsNativeSettings.EnsureInitialized("NBSOverride=7,NBSLinkType=2,NBSSyncModelDate=2026:09:09-03:00:00");
Assert(partial.StartsWith("NBSOverride=7,NBSLinkType=2,NBSSyncModelDate=2026:09:09-03:00:00,"), "Partial recovery preserves classification, instance-only mode and sync timestamp");
Assert(NbsNativeSettings.EnsureInitialized("NBSOverride=").StartsWith("NBSOverride=0,"), "Empty override cannot leave the vendor object null");
foreach (var value in new[] { "NBSOverride=99", "NBSOverride=0,NBSOverride=1", "broken" })
{
    bool rejected = false;
    try { NbsNativeSettings.EnsureInitialized(value); }
    catch (InvalidOperationException) { rejected = true; }
    Assert(rejected, "Ambiguous/corrupt settings are rejected: " + value);
}
Assert(NbsNativeSettings.IsProjectParameter("NBS Override") && NbsNativeSettings.IsProjectParameter("NBS Project Date")
    && NbsNativeSettings.IsProjectParameter("NBS Project Id") && !NbsNativeSettings.IsProjectParameter("NBS Instance Classificationcode"),
    "Project settings are excluded from ordinary element parameter sync");
