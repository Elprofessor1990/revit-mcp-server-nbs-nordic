using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace revit_mcp_plugin.Configuration
{
    /// <summary>Shared with the Node server; no credentials enter model data or MCP replies.</summary>
    public static class NbsUserSettings
    {
        public static readonly string[] LinkModes = { "typeOnly", "instanceOnly", "typeAndInstance" };
        public static readonly string[] SyncFields = { "id", "classificationcode", "name", "date", "docLink" };

        private static string ConfigPath => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".mcp-revit", "nbs-config.json");

        private static JObject Load() => File.Exists(ConfigPath) ? JObject.Parse(File.ReadAllText(ConfigPath)) : new JObject();

        // Atomic replacement prevents a running MCP server reading a partial file.
        private static void Save(JObject config)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(ConfigPath));
            string temp = ConfigPath + "." + Guid.NewGuid().ToString("N") + ".tmp";
            File.WriteAllText(temp, config.ToString(Formatting.Indented));
            try
            {
                if (File.Exists(ConfigPath)) File.Replace(temp, ConfigPath, null);
                else File.Move(temp, ConfigPath);
            }
            finally { if (File.Exists(temp)) File.Delete(temp); }
        }

        public static string ReadApiKey()
        {
            if (File.Exists(ConfigPath))
            {
                var key = (string)Load()["apiKey"];
                if (!string.IsNullOrWhiteSpace(key)) return key.Trim();
            }
            var env = Environment.GetEnvironmentVariable("NBS_API_KEY");
            if (!string.IsNullOrWhiteSpace(env)) return env.Trim();
            string legacy = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".claude", "nbs_api_key.txt");
            if (File.Exists(legacy))
            {
                var lines = File.ReadAllLines(legacy);
                return lines.Length == 0 ? "" : lines[0].Trim();
            }
            return "";
        }

        public static void SaveApiKey(string key)
        {
            var config = Load();
            config["apiKey"] = key.Trim();
            Save(config);
        }

        /// <summary>Sync defaults for one model (link mode + fields). Unknown/invalid values read as unset.</summary>
        public static void ReadModelSettings(string modelKey, out string linkMode, out string[] fields)
        {
            linkMode = null;
            fields = null;
            if (string.IsNullOrEmpty(modelKey) || !File.Exists(ConfigPath)) return;
            JObject entry;
            try { entry = Load()["models"]?[modelKey] as JObject; }
            catch { return; }
            if (entry == null) return;
            var mode = (string)entry["linkMode"];
            if (LinkModes.Contains(mode)) linkMode = mode;
            if (entry["fields"] is JArray array)
            {
                var values = array.Select(v => (string)v).ToArray();
                if (values.All(v => SyncFields.Contains(v))) fields = values.Distinct().ToArray();
            }
        }

        public static void SaveModelSettings(string modelKey, string linkMode, IEnumerable<string> fields)
        {
            if (string.IsNullOrEmpty(modelKey)) throw new ArgumentException("Modellen er ikke identificeret.");
            if (!LinkModes.Contains(linkMode)) throw new ArgumentException("Vælg en koblingstype.");
            var selected = fields.Where(f => SyncFields.Contains(f)).Distinct().ToArray();
            if (selected.Length == 0) throw new ArgumentException("Vælg mindst ét NBS-felt.");
            var config = Load();
            var models = config["models"] as JObject ?? new JObject();
            models[modelKey] = new JObject { ["linkMode"] = linkMode, ["fields"] = new JArray(selected) };
            config["models"] = models;
            Save(config);
        }
    }
}
