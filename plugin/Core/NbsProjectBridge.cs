using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Newtonsoft.Json.Linq;

namespace revit_mcp_plugin.Core
{
    /// <summary>One serialized, expiring request shared by Settings and the TCP bridge.</summary>
    public sealed class NbsProjectBridge : IExternalEventHandler
    {
        private readonly object gate = new object();
        private readonly ExternalEvent externalEvent;
        private Pending pending;
        private bool executing;

        private sealed class Pending
        {
            internal JObject Args;
            internal DateTime Deadline = DateTime.UtcNow.AddSeconds(30);
            internal TaskCompletionSource<object> Completion = new TaskCompletionSource<object>(TaskCreationOptions.RunContinuationsAsynchronously);
        }

        public NbsProjectBridge() { externalEvent = ExternalEvent.Create(this); }

        public async Task<object> RequestAsync(JObject args)
        {
            var request = new Pending { Args = (JObject)args.DeepClone() };
            lock (gate)
            {
                if (pending != null || executing) throw new InvalidOperationException("En projektoperation kører allerede. Prøv igen om et øjeblik.");
                pending = request;
                var raised = externalEvent.Raise();
                if (raised != ExternalEventRequest.Accepted && raised != ExternalEventRequest.Pending)
                {
                    pending = null;
                    throw new InvalidOperationException("Revit kunne ikke modtage projektoperationen. Luk eventuelle dialoger og prøv igen.");
                }
            }
            if (await Task.WhenAny(request.Completion.Task, Task.Delay(30000)) != request.Completion.Task)
            {
                lock (gate) { if (ReferenceEquals(pending, request)) pending = null; }
                throw new TimeoutException("Revit svarede ikke. Luk eventuelle dialoger, kontrollér projektstatus og prøv igen.");
            }
            return await request.Completion.Task;
        }

        public void Execute(UIApplication app)
        {
            Pending request;
            lock (gate) { request = pending; pending = null; executing = request != null; }
            if (request == null) return;
            try
            {
                if (DateTime.UtcNow > request.Deadline) throw new TimeoutException("Projektoperationen udløb før udførelse.");
                request.Completion.TrySetResult(Run(app, request.Args));
            }
            catch (Exception ex) { request.Completion.TrySetException(ex); }
            finally { lock (gate) executing = false; }
        }

        /// <summary>
        /// Dispatch one operation against the active model. Must run in a Revit API context:
        /// the external event above, or an IExternalCommand such as NbsBridgeSmokeTest.
        /// </summary>
        internal static object Run(UIApplication app, JObject args)
        {
            var doc = app.ActiveUIDocument?.Document;
            if (doc == null || doc.IsFamilyDocument) throw new InvalidOperationException("Åbn en Revit-projektmodel først.");
            string operation = (string)args["operation"] ?? "status";
            if (operation == "snapshot") return Snapshot(doc, args);
            if (operation == "write_parameters") return WriteParameters(doc, args);
            if (operation == "connect") Connect(app, doc, args);
            else if (operation != "status") throw new ArgumentException("Ukendt projektoperation.");
            return GetStatus(doc, app.Application.VersionNumber);
        }

        public string GetName() => "NBS Nordic project connection";

        private static readonly string[] RequiredNames = {
            "NBS Project Id", "NBS Project Date", "NBS Override",
            "NBS Component Type Id", "NBS Classificationcode", "NBS Component Name", "NBS Date", "NBS Doc Link",
            "NBS Component Instance Id", "NBS Instance Classificationcode", "NBS Instance Component Name", "NBS Instance Date", "NBS Instance Doc Link"
        };
        private static readonly Guid ProjectGuid = new Guid("16e40c4d-645d-42dd-9bd6-7f95769fae74");

        private static string ModelKey(Document doc) => doc.ProjectInformation.UniqueId + "|" + doc.PathName;

        private static Dictionary<string, string> ReadParameters(Element element)
        {
            return RequiredNames.Where(n => !NbsNativeSettings.IsProjectParameter(n)).ToDictionary(n => n, n => element.LookupParameter(n)?.AsString());
        }

        private static object Snapshot(Document doc, JObject args)
        {
            var category = (BuiltInCategory)Enum.Parse(typeof(BuiltInCategory), (string)args["category"], true);
            int maxTypes = (int?)args["maxTypes"] ?? 500;
            var elements = new FilteredElementCollector(doc).OfCategory(category).WhereElementIsNotElementType().ToElements();
            if (elements.Count > 20000) throw new InvalidOperationException("Kategorien indeholder mere end 20.000 instanser. Opdel synkroniseringen før du fortsætter.");
            var types = elements.Select(e => e.GetTypeId()).Distinct().Select(doc.GetElement).OfType<ElementType>().ToList();
            if (types.Count > maxTypes) throw new InvalidOperationException("Kategorien har " + types.Count + " anvendte typer. Hæv maxTypes for at medtage dem alle; intet er ændret.");
            return new {
                modelKey = ModelKey(doc), projectId = doc.ProjectInformation.get_Parameter(ProjectGuid)?.AsString(),
                types = types.Select(t => new { typeId = long.Parse(t.Id.ToString()), uniqueId = t.UniqueId, typeName = t.Name, familyName = t.FamilyName, parameters = ReadParameters(t) }).ToArray(),
                instances = elements.Select(e => new { id = long.Parse(e.Id.ToString()), uniqueId = e.UniqueId, typeId = long.Parse(e.GetTypeId().ToString()), parameters = ReadParameters(e) }).ToArray()
            };
        }

        private static object WriteParameters(Document doc, JObject args)
        {
            if ((string)args["expectedModelKey"] != ModelKey(doc) || (string)args["projectId"] != doc.ProjectInformation.get_Parameter(ProjectGuid)?.AsString())
                throw new InvalidOperationException("Den aktive model eller NBS-projektkoblingen er ændret. Kør en ny forhåndsvisning.");
            var requests = args["requests"] as JArray;
            if (requests == null || requests.Count > 200000) throw new ArgumentException("Ugyldig størrelse på parameterskrivningen.");
            var writes = new List<Tuple<Parameter, string>>();
            foreach (JObject request in requests)
            {
                string name = (string)request["parameterName"];
                if (NbsNativeSettings.IsProjectParameter(name) || !RequiredNames.Contains(name)) throw new ArgumentException("Kun understøttede NBS-felter kan synkroniseres. NBS' projektindstillinger må ikke ændres af parametersynkronisering.");
                var element = doc.GetElement((string)request["uniqueId"]);
                var parameter = element?.LookupParameter(name);
                if (parameter == null || parameter.IsReadOnly || parameter.StorageType != StorageType.String)
                    throw new InvalidOperationException("NBS-feltet " + name + " mangler eller er skrivebeskyttet. Forbind projektet igen for at kontrollere bindingerne.");
                // Optimistic concurrency check: do not overwrite a change made after the snapshot.
                string previous = (string)request["previousValue"] ?? "";
                if ((parameter.AsString() ?? "") != previous)
                    throw new InvalidOperationException("Et NBS-felt er ændret siden forhåndsvisningen. Kør synkroniseringen igen.");
                writes.Add(Tuple.Create(parameter, (string)request["value"] ?? ""));
            }
            if (writes.Count == 0) return new { writtenParameters = 0, verified = true };
            using (var tx = new Transaction(doc, "Synkroniser NBS-klassifikation"))
            {
                tx.Start();
                foreach (var write in writes)
                    if (!write.Item1.Set(write.Item2) || write.Item1.AsString() != write.Item2)
                        throw new InvalidOperationException("Et NBS-felt kunne ikke verificeres; synkroniseringen rulles tilbage.");
                if (tx.Commit() != TransactionStatus.Committed) throw new InvalidOperationException("Revit gennemførte ikke synkroniseringen.");
            }
            return new { writtenParameters = writes.Count, verified = true };
        }
        private static string DefinitionPath(string version) => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "NBSNordic", "NBSNordicRevitTools", version, "Resources", "NBSNordicSharedParameters.txt");

        private static Dictionary<string, Guid> ReadDefinitions(string path)
        {
            if (!File.Exists(path)) throw new FileNotFoundException("NBS' parameterfil mangler. Installer NBS Nordic til denne Revit-version først.", path);
            var result = new Dictionary<string, Guid>();
            foreach (var line in File.ReadLines(path))
            {
                var fields = line.Split('\t');
                if (fields.Length > 3 && fields[0] == "PARAM" && RequiredNames.Contains(fields[2]))
                    result.Add(fields[2], Guid.Parse(fields[1]));
            }
            if (RequiredNames.Any(n => !result.ContainsKey(n)) || result["NBS Project Id"] != ProjectGuid)
                throw new InvalidOperationException("NBS-parameterfilen indeholder ikke alle de forventede definitioner.");
            return result;
        }

        private static object GetStatus(Document doc, string version)
        {
            var bound = new HashSet<string>();
            var groupSettings = new List<string>();
            var iterator = doc.ParameterBindings.ForwardIterator();
            while (iterator.MoveNext())
            {
                bound.Add(iterator.Key.Name);
                if (RequiredNames.Contains(iterator.Key.Name) && !NbsNativeSettings.IsProjectParameter(iterator.Key.Name)
                    && iterator.Current is InstanceBinding && iterator.Key is InternalDefinition d && !d.VariesAcrossGroups)
                    groupSettings.Add(d.Name);
            }
            var id = doc.ProjectInformation.get_Parameter(ProjectGuid)?.AsString();
            string settings = doc.ProjectInformation.LookupParameter("NBS Override")?.AsString();
            bool settingsReady;
            try { settingsReady = !string.IsNullOrEmpty(settings) && NbsNativeSettings.EnsureInitialized(settings) == settings; }
            catch (InvalidOperationException) { settingsReady = false; }
            return new {
                modelKey = ModelKey(doc), documentTitle = doc.Title, filePath = doc.PathName,
                projectId = string.IsNullOrWhiteSpace(id) ? null : id,
                missingParameters = RequiredNames.Where(n => !bound.Contains(n)).ToArray(),
                instanceParametersNeedingGroupVariation = groupSettings.ToArray(),
                nativeSettingsReady = settingsReady,
                // The official addin's own link-type setting: raw code plus our decoded link mode
                // (mapping verified 2026-09-09, see NbsNativeSettings.LinkTypeCodes). Read-only here.
                nativeLinkType = NbsNativeSettings.ReadValue(settings, "NBSLinkType"),
                nativeLinkMode = NbsNativeSettings.DecodeLinkType(NbsNativeSettings.ReadValue(settings, "NBSLinkType")),
                parameterFileAvailable = File.Exists(DefinitionPath(version)),
                isReadOnly = doc.IsReadOnly
            };
        }

        private static void Connect(UIApplication app, Document doc, JObject args)
        {
            string expected = (string)args["expectedModelKey"];
            if (string.IsNullOrEmpty(expected) || expected != ModelKey(doc))
                throw new InvalidOperationException("Den aktive Revit-model er ændret. Hent projektstatus og vælg modellen igen.");
            string projectId = (string)args["projectId"];
            if (!long.TryParse(projectId, out var parsedId) || parsedId <= 0)
                throw new ArgumentException("Vælg et gyldigt NBS-projekt fra projektlisten.");
            string current = doc.ProjectInformation.get_Parameter(ProjectGuid)?.AsString();
            if (!string.IsNullOrWhiteSpace(current) && current != projectId)
                throw new InvalidOperationException("Modellen er allerede koblet til NBS-projekt " + current + ". Et projektskift kræver særskilt migrering af eksisterende bygningsdelslinks.");
            if (doc.IsReadOnly) throw new InvalidOperationException("Revit-modellen er skrivebeskyttet.");

            string path = DefinitionPath(app.Application.VersionNumber);
            var ids = ReadDefinitions(path);
            var existing = new Dictionary<string, Tuple<Definition, ElementBinding>>();
            var iterator = doc.ParameterBindings.ForwardIterator();
            while (iterator.MoveNext())
            {
                if (!RequiredNames.Contains(iterator.Key.Name)) continue;
                var definition = iterator.Key as InternalDefinition;
                var shared = definition == null ? null : doc.GetElement(definition.Id) as SharedParameterElement;
                if (shared == null || shared.GuidValue != ids[iterator.Key.Name] || existing.ContainsKey(iterator.Key.Name))
                    throw new InvalidOperationException("Parameterkonflikt for " + iterator.Key.Name + ". Eksisterende værdier er ikke ændret.");
                existing.Add(iterator.Key.Name, Tuple.Create(iterator.Key, iterator.Current as ElementBinding));
            }

            string originalFile = app.Application.SharedParametersFilename;
            try
            {
                app.Application.SharedParametersFilename = path;
                var file = app.Application.OpenSharedParameterFile();
                if (file == null) throw new InvalidOperationException("NBS-parameterfilen kunne ikke åbnes.");
                var definitions = new Dictionary<string, ExternalDefinition>();
                foreach (DefinitionGroup group in file.Groups)
                    foreach (Definition definition in group.Definitions)
                        if (RequiredNames.Contains(definition.Name)) definitions.Add(definition.Name, (ExternalDefinition)definition);

                using (var tx = new Transaction(doc, "Forbind NBS Nordic-projekt"))
                {
                    tx.Start();
                    foreach (var name in RequiredNames)
                    {
                        bool project = NbsNativeSettings.IsProjectParameter(name);
                        bool instance = project || name.Contains("Instance");
                        var categories = new CategorySet();
                        if (project) categories.Insert(doc.Settings.Categories.get_Item(BuiltInCategory.OST_ProjectInformation));
                        else
                            foreach (Category category in doc.Settings.Categories)
                                if (category.CategoryType == CategoryType.Model && category.AllowsBoundParameters && !category.IsTagCategory)
                                    categories.Insert(category);

                        bool needsBinding = true;
                        if (existing.TryGetValue(name, out var entry))
                        {
                            if (entry.Item2 == null || (entry.Item2 is InstanceBinding) != instance)
                                throw new InvalidOperationException("Forkert type-/instansbinding for " + name);
                            bool complete = true;
                            foreach (Category category in categories)
                                if (!entry.Item2.Categories.Contains(category)) complete = false;
                            needsBinding = !complete;
                            foreach (Category category in entry.Item2.Categories) categories.Insert(category);
                        }
                        var def = definitions[name];
                        if (needsBinding)
                        {
                            ElementBinding binding = instance
                                ? (ElementBinding)app.Application.Create.NewInstanceBinding(categories)
                                : app.Application.Create.NewTypeBinding(categories);
                            bool ok = existing.ContainsKey(name)
                                ? doc.ParameterBindings.ReInsert(def, binding, GroupTypeId.IdentityData)
                                : doc.ParameterBindings.Insert(def, binding, GroupTypeId.IdentityData);
                            if (!ok) throw new InvalidOperationException("Kunne ikke tilknytte " + name);
                        }
                        if (instance && !project)
                        {
                            var internalDef = SharedParameterElement.Lookup(doc, def.GUID)?.GetDefinition();
                            if (internalDef == null) throw new InvalidOperationException("Kunne ikke finde definitionen for " + name);
                            if (!internalDef.VariesAcrossGroups) internalDef.SetAllowVaryBetweenGroups(doc, true);
                        }
                    }
                    doc.Regenerate();
                    var nativeSettings = doc.ProjectInformation.LookupParameter("NBS Override");
                    if (nativeSettings == null || nativeSettings.IsReadOnly)
                        throw new InvalidOperationException("NBS Override mangler eller er skrivebeskyttet.");
                    string initializedSettings = NbsNativeSettings.EnsureInitialized(nativeSettings.AsString());
                    if (initializedSettings != nativeSettings.AsString() && !nativeSettings.Set(initializedSettings))
                        throw new InvalidOperationException("NBS' projektindstillinger kunne ikke initialiseres.");
                    var parameter = doc.ProjectInformation.get_Parameter(ProjectGuid);
                    if (parameter == null || parameter.IsReadOnly || (!string.Equals(parameter.AsString(), projectId) && !parameter.Set(projectId)))
                        throw new InvalidOperationException("NBS-projekt-id kunne ikke gemmes i modellen.");
                    if (tx.Commit() != TransactionStatus.Committed) throw new InvalidOperationException("Revit gennemførte ikke projektkoblingen.");
                }
            }
            finally { app.Application.SharedParametersFilename = originalFile; }
        }
    }
}
