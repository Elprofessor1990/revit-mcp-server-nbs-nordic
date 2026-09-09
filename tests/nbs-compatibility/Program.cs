using System;
using revit_mcp_plugin.Core;
using Newtonsoft.Json.Linq;

static void Assert(bool condition, string message)
{
    if (!condition) throw new Exception(message);
    Console.WriteLine("PASS: " + message);
}

var initialized = NbsNativeSettings.EnsureInitialized(null);
Assert(initialized.StartsWith("NBSOverride=0,"), "Missing native state initializes the overwrite object without enabling parameter overrides");
Assert(initialized.Contains("NBSLinkType=1"), "New native settings seed Type Only, the least intrusive link type");
Assert(NbsNativeSettings.DecodeLinkType("0") == "typeAndInstance" && NbsNativeSettings.DecodeLinkType("1") == "typeOnly"
    && NbsNativeSettings.DecodeLinkType("2") == "instanceOnly", "NBSLinkType codes decode by the mapping verified against the addin's Settings dialog");
Assert(NbsNativeSettings.DecodeLinkType("3") == null && NbsNativeSettings.DecodeLinkType("") == null && NbsNativeSettings.DecodeLinkType(null) == null,
    "Unknown NBSLinkType codes are not guessed");
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

// Live 2026-09-09: Newtonsoft's default date parsing turned an NBS updated_at into a
// DateTime and wrote "09/09/2026 02:38:14" to "NBS Date"; later previews then failed
// their concurrency check against the ISO text Revit actually held.
var rpc = "{\"jsonrpc\":\"2.0\",\"id\":\"7\",\"method\":\"nbs_project\",\"params\":{\"operation\":\"write_parameters\",\"requests\":[{\"parameterName\":\"NBS Date\",\"previousValue\":\"2026-01-31T10:00:00.000000Z\",\"value\":\"2026-09-09T02:38:14.000000Z\"}]}}";
var prm = RpcJson.Params(rpc);
var req = (JObject)prm["requests"][0];
Assert(req["value"].Type == JTokenType.String && (string)req["value"] == "2026-09-09T02:38:14.000000Z", "ISO date strings in socket requests stay strings, byte-for-byte");
Assert((string)req["previousValue"] == "2026-01-31T10:00:00.000000Z", "previousValue survives unchanged for the optimistic concurrency check");
Assert(JObject.Parse(rpc)["params"]["requests"][0]["value"].Type == JTokenType.Date, "Default parsing would have converted it (documents why RpcJson exists)");
Assert(RpcJson.Params("{\"jsonrpc\":\"2.0\",\"id\":\"8\",\"method\":\"x\"}") == null, "Missing params reads as null, not an exception");
