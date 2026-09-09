using System;
using System.IO;
using Autodesk.Revit.UI;
using System.Reflection;
using System.Windows.Media.Imaging;
using revit_mcp_plugin.Helpers;
using revit_mcp_plugin.UI;
using revit_mcp_plugin.Utils;
using Autodesk.Revit.UI.Events;
using Newtonsoft.Json;
using revit_mcp_plugin.Configuration;



namespace revit_mcp_plugin.Core
{
    public class Application : IExternalApplication
    {
        public Result OnStartup(UIControlledApplication application)
        {
            application.Idling += StartConnectionWhenReady;
            var pluginDir = Path.GetDirectoryName(typeof(Application).Assembly.Location);
            McpLogger.Initialize(pluginDir);
            McpLogger.Info("Application", "Plugin starting");

            // Auto-configure Claude Desktop on first run (silent, never crashes)
            ClaudeDesktopConfigurator.EnsureConfigured();

            // Register Dockable Panel
            try
            {
                application.RegisterDockablePane(
                    MCPDockablePaneProvider.PaneId,
                    "MCP Server",
                    new MCPDockablePaneProvider());
            }
            catch (Exception ex)
            {
                System.Diagnostics.Trace.WriteLine($"[RevitMCP] Panel registration skipped: {ex.Message}");
            }

            RibbonPanel mcpPanel = application.CreateRibbonPanel("Revit MCP Plugin");

            PushButtonData pushButtonData = new PushButtonData("ID_EXCMD_TOGGLE_REVIT_MCP", "Revit MCP\r\n Switch",
                Assembly.GetExecutingAssembly().Location, "revit_mcp_plugin.Core.MCPServiceConnection");
            pushButtonData.ToolTip = "Open / Close mcp server";
            pushButtonData.Image = new BitmapImage(new Uri("/RevitMCPPlugin;component/Core/Ressources/icon-16.png", UriKind.RelativeOrAbsolute));
            pushButtonData.LargeImage = new BitmapImage(new Uri("/RevitMCPPlugin;component/Core/Ressources/icon-32.png", UriKind.RelativeOrAbsolute));
            mcpPanel.AddItem(pushButtonData);

            PushButtonData panelButtonData = new PushButtonData("ID_EXCMD_TOGGLE_MCP_PANEL", "MCP\r\n Panel",
                Assembly.GetExecutingAssembly().Location, "revit_mcp_plugin.Core.ToggleMCPPanel");
            panelButtonData.ToolTip = "Show / Hide MCP monitoring panel";
            panelButtonData.Image = new BitmapImage(new Uri("/RevitMCPPlugin;component/Core/Ressources/panel-16.png", UriKind.RelativeOrAbsolute));
            panelButtonData.LargeImage = new BitmapImage(new Uri("/RevitMCPPlugin;component/Core/Ressources/panel-32.png", UriKind.RelativeOrAbsolute));
            mcpPanel.AddItem(panelButtonData);

            PushButtonData mcp_settings_pushButtonData = new PushButtonData("ID_EXCMD_MCP_SETTINGS", "Settings",
                Assembly.GetExecutingAssembly().Location, "revit_mcp_plugin.Core.Settings");
            mcp_settings_pushButtonData.ToolTip = "MCP Settings";
            mcp_settings_pushButtonData.Image = new BitmapImage(new Uri("/RevitMCPPlugin;component/Core/Ressources/settings-16.png", UriKind.RelativeOrAbsolute));
            mcp_settings_pushButtonData.LargeImage = new BitmapImage(new Uri("/RevitMCPPlugin;component/Core/Ressources/settings-32.png", UriKind.RelativeOrAbsolute));
            mcpPanel.AddItem(mcp_settings_pushButtonData);

            return Result.Succeeded;
        }

        public Result OnShutdown(UIControlledApplication application)
        {
            application.Idling -= StartConnectionWhenReady;
            try
            {
                if (SocketService.Instance.IsRunning)
                {
                    SocketService.Instance.Stop();
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Trace.WriteLine($"[RevitMCP] Error during shutdown: {ex.Message}");
            }

            return Result.Succeeded;
        }

        private void StartConnectionWhenReady(object sender, IdlingEventArgs args)
        {
            var uiApp = sender as UIApplication;
            if (uiApp == null) return;
            uiApp.Idling -= StartConnectionWhenReady;
            try
            {
                var path = PathManager.GetCommandRegistryFilePath();
                var config = File.Exists(path)
                    ? JsonConvert.DeserializeObject<FrameworkConfig>(File.ReadAllText(path))
                    : new FrameworkConfig();
                if (config?.Settings?.AutoStart == false) return;
                SocketService.Instance.Initialize(uiApp);
                SocketService.Instance.Start();
            }
            catch (Exception ex)
            {
                McpLogger.Error("Application", "Automatic connection failed; open Settings to retry", ex);
            }
        }
    }
}
