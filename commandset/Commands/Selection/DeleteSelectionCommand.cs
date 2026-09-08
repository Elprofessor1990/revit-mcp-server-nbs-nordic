using Autodesk.Revit.UI;
using Newtonsoft.Json.Linq;
using RevitMCPCommandSet.Services;
using RevitMCPSDK.API.Base;
using System;

namespace RevitMCPCommandSet.Commands.Selection
{
    public class DeleteSelectionCommand : ExternalEventCommandBase
    {
        private static readonly object _executionLock = new object();
        private DeleteSelectionEventHandler _handler => (DeleteSelectionEventHandler)Handler;

        public override string CommandName => "delete_selection";

        public DeleteSelectionCommand(UIApplication uiApp)
            : base(new DeleteSelectionEventHandler(), uiApp) { }

        public override object Execute(JObject parameters, string requestId)
        {
            lock (_executionLock)
            {
                try
                {
                    _handler.SelectionName = parameters?["name"]?.Value<string>() ?? "";

                    _handler.SetParameters();

                    if (RaiseAndWaitForCompletion(15000))
                        return _handler.Result;

                    throw new TimeoutException("Delete selection timed out");
                }
                catch (Exception ex)
                {
                    throw new Exception($"Delete selection failed: {ex.Message}");
                }
            }
        }
    }
}
