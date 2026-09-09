using System;
using System.Collections.Generic;
using System.Linq;

namespace revit_mcp_plugin.Core
{
    // NBS 1.6 reads this project parameter before Sync Now. A missing/empty
    // NBSOverride entry leaves its NBSOverwriteobj null and crashes Execute.
    public static class NbsNativeSettings
    {
        public static readonly string[] ProjectParameterNames = {
            "NBS Project Id", "NBS Project Date", "NBS Override"
        };

        private static readonly KeyValuePair<string, string>[] Defaults = {
            new KeyValuePair<string, string>("NBSOverride", "0"),
            new KeyValuePair<string, string>("NBSSyncSch", "0"),
            new KeyValuePair<string, string>("NBSSyncRooms", "0"),
            new KeyValuePair<string, string>("NBSSyncSchDate", ""),
            new KeyValuePair<string, string>("NBSSyncModelDate", ""),
            new KeyValuePair<string, string>("NBSSyncAreas", "0"),
            new KeyValuePair<string, string>("NBSSyncDesignOptions", "0"),
            new KeyValuePair<string, string>("NBS3DView", "0"),
            new KeyValuePair<string, string>("NBSRename", "0"),
            new KeyValuePair<string, string>("NBSRenameFinalName", ""),
            new KeyValuePair<string, string>("NBSIFC", "0"),
            new KeyValuePair<string, string>("NBSLinkType", "1")
        };

        public static bool IsProjectParameter(string name) => ProjectParameterNames.Contains(name);

        /// <summary>Read-only lookup of one key in the native settings string; null when absent or malformed.</summary>
        public static string ReadValue(string current, string key)
        {
            if (string.IsNullOrEmpty(current)) return null;
            foreach (var entry in current.Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries))
            {
                int separator = entry.IndexOf('=');
                if (separator > 0 && entry.Substring(0, separator) == key) return entry.Substring(separator + 1);
            }
            return null;
        }

        public static string EnsureInitialized(string current)
        {
            var entries = (current ?? "").Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries).ToList();
            var keys = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < entries.Count; i++)
            {
                int separator = entries[i].IndexOf('=');
                if (separator < 1) throw new InvalidOperationException("NBS Override indeholder en ugyldig indstilling. Ingen værdier er ændret.");
                string key = entries[i].Substring(0, separator);
                string value = entries[i].Substring(separator + 1);
                if (!keys.Add(key)) throw new InvalidOperationException("NBS Override indeholder en gentaget indstilling: " + key);
                if (key == "NBSOverride")
                {
                    if (value.Length == 0) entries[i] = "NBSOverride=0";
                    else if (value.Length != 1 || value[0] < '0' || value[0] > '9')
                        throw new InvalidOperationException("NBSOverride har en ukendt værdi. Eksisterende indstillinger er bevaret.");
                }
            }
            foreach (var entry in Defaults)
                if (keys.Add(entry.Key)) entries.Add(entry.Key + "=" + entry.Value);
            var result = string.Join(",", entries);
            return result == (current ?? "") ? current : result;
        }
    }
}
