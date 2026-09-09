using System;
using System.IO;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using revit_mcp_plugin.Configuration;

namespace revit_mcp_plugin.Core
{
    /// <summary>
    /// Developer command, not on the ribbon. Load this DLL in Revit Add-In Manager and run
    /// the command to exercise the NBS bridge on the active model without the MCP server:
    /// status (bindings, native NBS settings, decoded link type, the per-model sync choice)
    /// and a read-only snapshot of one category. Nothing is written to the model or to NBS.
    /// Rebuild, press F5 in Add-In Manager, run again.
    /// </summary>
    [Transaction(TransactionMode.Manual)]
    public class NbsBridgeSmokeTest : IExternalCommand
    {
        // Change here to probe another category; the MCP tool takes it as an argument.
        private const string Category = "OST_Walls";
        private const int MaxTypes = 50;

        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            // ModuleVersionId changes on every build: proves Add-In Manager loaded the fresh DLL (Location is empty when loaded from memory).
            var report = new JObject { ["ranAt"] = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"), ["buildId"] = typeof(NbsBridgeSmokeTest).Module.ModuleVersionId.ToString() };
            var app = commandData.Application;
            try
            {
                var status = JObject.FromObject(NbsProjectBridge.Run(app, new JObject { ["operation"] = "status" }));
                report["status"] = status;

                string modelKey = (string)status["modelKey"];
                string linkMode = null; string[] fields = null;
                try { NbsUserSettings.ReadModelSettings(modelKey, out linkMode, out fields); }
                catch (Exception ex) { report["modelSyncSettingsError"] = ex.Message; }
                report["modelSyncSettings"] = new JObject { ["linkMode"] = linkMode, ["fields"] = fields == null ? null : new JArray(fields) };

                var snapshot = JObject.FromObject(NbsProjectBridge.Run(app, new JObject { ["operation"] = "snapshot", ["category"] = Category, ["maxTypes"] = MaxTypes }));
                report["snapshot"] = new JObject {
                    ["category"] = Category,
                    ["types"] = snapshot["types"]?.Count() ?? 0,
                    ["instances"] = snapshot["instances"]?.Count() ?? 0,
                    ["firstType"] = snapshot["types"]?.First,
                    ["firstInstance"] = snapshot["instances"]?.First,
                };
                report["result"] = "OK";
            }
            catch (Exception ex)
            {
                report["result"] = "FAILED";
                report["error"] = ex.GetType().Name + ": " + ex.Message;
            }

            string path = Path.Combine(Path.GetTempPath(), "revit-mcp-nbs-smoke.json");
            report["savedTo"] = path;
            string json = JsonConvert.SerializeObject(report, Formatting.Indented);
            try { File.WriteAllText(path, json); } catch { /* the window still shows the report */ }
            ShowReport(json, path);
            return Result.Succeeded;
        }

        private static void ShowReport(string json, string path)
        {
            var text = new System.Windows.Controls.TextBox {
                Text = json, IsReadOnly = true, AcceptsReturn = true, TextWrapping = TextWrapping.NoWrap,
                FontFamily = new System.Windows.Media.FontFamily("Consolas"), FontSize = 12,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            };
            var copy = new Button { Content = "Kopiér", Width = 90, Margin = new Thickness(0, 8, 8, 0), HorizontalAlignment = HorizontalAlignment.Left };
            copy.Click += (s, e) => { try { Clipboard.SetText(json); } catch { } };
            var footer = new TextBlock { Text = "Gemt som " + path, Margin = new Thickness(0, 12, 0, 0), VerticalAlignment = VerticalAlignment.Center, Foreground = System.Windows.Media.Brushes.Gray };
            var bottom = new StackPanel { Orientation = Orientation.Horizontal };
            bottom.Children.Add(copy); bottom.Children.Add(footer);
            var root = new DockPanel { Margin = new Thickness(10) };
            DockPanel.SetDock(bottom, Dock.Bottom);
            root.Children.Add(bottom); root.Children.Add(text);
            var window = new Window { Title = "NBS Bridge Smoke Test", Width = 760, Height = 640, Content = root, WindowStartupLocation = WindowStartupLocation.CenterScreen };
            _ = new System.Windows.Interop.WindowInteropHelper(window) { Owner = System.Diagnostics.Process.GetCurrentProcess().MainWindowHandle };
            window.ShowDialog();
        }
    }
}
