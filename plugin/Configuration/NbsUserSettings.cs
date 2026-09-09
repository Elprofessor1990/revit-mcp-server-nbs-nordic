using System;
using System.IO;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace revit_mcp_plugin.Configuration
{
    /// <summary>Shared with the Node server; no credentials enter model data or MCP replies.</summary>
    public static class NbsUserSettings
    {
        private static string ConfigPath => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".mcp-revit", "nbs-config.json");

        public static string ReadApiKey()
        {
            if (File.Exists(ConfigPath))
            {
                var config = JObject.Parse(File.ReadAllText(ConfigPath));
                var key = (string)config["apiKey"];
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
            Directory.CreateDirectory(Path.GetDirectoryName(ConfigPath));
            var config = File.Exists(ConfigPath) ? JObject.Parse(File.ReadAllText(ConfigPath)) : new JObject();
            config["apiKey"] = key.Trim();
            // Atomic replacement prevents a running MCP server reading a partial key.
            string temp = ConfigPath + "." + Guid.NewGuid().ToString("N") + ".tmp";
            File.WriteAllText(temp, config.ToString(Formatting.Indented));
            try
            {
                if (File.Exists(ConfigPath)) File.Replace(temp, ConfigPath, null);
                else File.Move(temp, ConfigPath);
            }
            finally { if (File.Exists(temp)) File.Delete(temp); }
        }
    }
}
