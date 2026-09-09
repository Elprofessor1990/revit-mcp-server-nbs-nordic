using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using System;

namespace revit_mcp_plugin.Core
{
    [Transaction(TransactionMode.Manual)]
    public class MCPServiceConnection : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            try
            {
                // Obtain socket service.
                SocketService service = SocketService.Instance;

                if (service.IsRunning)
                {
                    service.Stop();
                    TaskDialog.Show("Revit MCP", "Forbindelsen er afbrudt. Klik igen for at forbinde.");
                }
                else
                {
                    service.Initialize(commandData.Application);
                    service.Start();
                    TaskDialog.Show("Revit MCP", service.IsRunning
                        ? "Revit er forbundet. Vælg dit NBS-projekt under Settings → NBS Nordic."
                        : "Forbindelsen kunne ikke startes. Se loggen under Settings.");
                }

                return Result.Succeeded;
            }
            catch (Exception ex)
            {
                message = ex.Message;
                return Result.Failed;
            }
        }
    }
}
