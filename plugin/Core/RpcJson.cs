using System.IO;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace revit_mcp_plugin.Core
{
    /// <summary>
    /// JSON parsing for socket requests that keeps every string a string.
    /// Newtonsoft's default DateParseHandling turns ISO-looking strings such as an NBS
    /// updated_at ("2026-09-09T02:38:14.000000Z") into DateTime tokens, which then
    /// re-serialize as "09/09/2026 02:38:14". Live 2026-09-09 that rewrote the value
    /// written to "NBS Date" and made every later optimistic-concurrency check fail.
    /// </summary>
    public static class RpcJson
    {
        public static JObject ParseObject(string json)
        {
            using (var reader = new JsonTextReader(new StringReader(json)) { DateParseHandling = DateParseHandling.None })
                return JObject.Load(reader);
        }

        /// <summary>The "params" object of a JSON-RPC request, or null when absent or not an object.</summary>
        public static JObject Params(string requestJson) => ParseObject(requestJson)["params"] as JObject;
    }
}
