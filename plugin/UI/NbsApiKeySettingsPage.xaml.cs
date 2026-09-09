using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Net.Http;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using Newtonsoft.Json.Linq;
using revit_mcp_plugin.Configuration;
using revit_mcp_plugin.Core;

namespace revit_mcp_plugin.UI
{
    public partial class NbsApiKeySettingsPage : Page
    {
        private bool loaded;
        private bool busy;
        private string verifiedKey;
        private JObject model;
        private static readonly HttpClient Client = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false })
        { Timeout = TimeSpan.FromSeconds(30) };

        public sealed class ProjectChoice
        {
            public string Id { get; set; }
            public string Name { get; set; }
            public string Classification { get; set; }
            public string Label => Name + " — " + Classification + " (#" + Id + ")";
        }

        public NbsApiKeySettingsPage()
        {
            InitializeComponent();
            try { ApiKeyPasswordBox.Password = NbsUserSettings.ReadApiKey(); }
            catch { StatusText.Text = "Den gemte nøgle kunne ikke læses. Indtast din NBS-nøgle igen."; }
        }

        private async void Page_Loaded(object sender, RoutedEventArgs e)
        {
            if (loaded) return;
            loaded = true;
            if (!string.IsNullOrWhiteSpace(ApiKeyPasswordBox.Password)) await LoadProjects();
            else await RefreshModel();
        }

        private void SetBusy(bool value)
        {
            busy = value;
            ApiKeyPasswordBox.IsEnabled = !value;
            LoadProjectsButton.IsEnabled = !value;
            ProjectsComboBox.IsEnabled = !value;
            CloneNameTextBox.IsEnabled = !value;
            UpdateButtons();
        }

        private void UpdateButtons()
        {
            if (ConnectButton == null || CloneButton == null) return;
            bool selected = !busy && verifiedKey != null && ProjectsComboBox.SelectedItem is ProjectChoice;
            ConnectButton.IsEnabled = selected && model != null;
            CloneButton.IsEnabled = selected;
        }

        private void ApiKeyPasswordBox_PasswordChanged(object sender, RoutedEventArgs e)
        {
            verifiedKey = null;
            UpdateButtons();
        }

        private async Task<JToken> Request(string key, string path, bool post = false)
        {
            using (var request = new HttpRequestMessage(post ? HttpMethod.Post : HttpMethod.Get, "https://nbsnordic.net/api/v2" + path))
            {
                request.Headers.Add("api-key", key);
                using (var response = await Client.SendAsync(request))
                {
                    if (!response.IsSuccessStatusCode)
                        throw new InvalidOperationException(response.StatusCode == System.Net.HttpStatusCode.Unauthorized
                            ? "NBS afviste nøglen. Kontrollér din personlige NBS API-nøgle."
                            : "NBS svarede HTTP " + (int)response.StatusCode + ". Kontrollér projektadgang og eventuelle Pro-rettigheder.");
                    return JToken.Parse(await response.Content.ReadAsStringAsync());
                }
            }
        }

        private async Task RefreshModel()
        {
            try
            {
                if (SocketService.Instance.NbsProjects == null) throw new InvalidOperationException("Åbn Settings igen fra Revit.");
                model = JObject.FromObject(await SocketService.Instance.NbsProjects.RequestAsync(new JObject { ["operation"] = "status" }));
                var projectId = (string)model["projectId"];
                ModelText.Text = "Revit: " + (string)model["documentTitle"] + "\n" +
                    (string.IsNullOrWhiteSpace(projectId) ? "Modellen er ikke koblet til NBS endnu." : "Koblet til NBS-projekt #" + projectId);
            }
            catch (Exception ex) { model = null; ModelText.Text = ex.Message; }
            UpdateButtons();
        }

        private async Task<bool> LoadProjects(string selectId = null)
        {
            SetBusy(true);
            StatusText.Text = "Kontrollerer NBS-adgang…";
            try
            {
                string key = ApiKeyPasswordBox.Password.Trim();
                if (string.IsNullOrEmpty(key)) throw new InvalidOperationException("Indtast din NBS API-nøgle først.");
                var response = await Request(key, "/projects") as JArray;
                if (response == null) throw new InvalidOperationException("NBS returnerede ikke en projektliste.");
                var projects = response.Where(p => (int?)p["active"] != 0).Select(p => new ProjectChoice {
                    Id = (string)p["id"], Name = (string)p["project_name"], Classification = (string)p["classification_system_name"]
                }).OrderBy(p => p.Name).ToList();
                NbsUserSettings.SaveApiKey(key);
                verifiedKey = key;
                ProjectsComboBox.ItemsSource = projects;
                await RefreshModel();
                ProjectsComboBox.SelectedValue = selectId ?? (string)model?["projectId"];
                StatusText.Text = "NBS forbundet — " + projects.Count + " aktive projekter. Nøglen er gemt til din AI.";
                return true;
            }
            catch (Exception ex) { verifiedKey = null; StatusText.Text = ex.Message; return false; }
            finally { SetBusy(false); }
        }

        private async void LoadProjects_Click(object sender, RoutedEventArgs e) { await LoadProjects(); }

        private void Project_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            var project = ProjectsComboBox.SelectedItem as ProjectChoice;
            ProjectDetailsText.Text = project == null ? "Vælg et projekt fra listen." : "Klassifikationssystem: " + project.Classification;
            UpdateButtons();
        }

        private async void Connect_Click(object sender, RoutedEventArgs e)
        {
            var project = ProjectsComboBox.SelectedItem as ProjectChoice;
            if (project == null || model == null || verifiedKey == null) return;
            string expectedModel = (string)model["modelKey"];
            SetBusy(true);
            try
            {
                StatusText.Text = "Kontrollerer projektet og klargør NBS-felter…";
                await Request(verifiedKey, "/projects/" + project.Id);
                model = JObject.FromObject(await SocketService.Instance.NbsProjects.RequestAsync(new JObject {
                    ["operation"] = "connect", ["projectId"] = project.Id, ["expectedModelKey"] = expectedModel
                }));
                SocketService.Instance.Start();
                if (!SocketService.Instance.IsRunning)
                    throw new InvalidOperationException("NBS-projektet er tilknyttet modellen, men MCP-forbindelsen kunne ikke starte. Gem modellen og kontrollér forbindelsen.");
                await RefreshModel();
                StatusText.Text = "Forbundet til " + project.Name + ". NBS-felterne er klar. Gem Revit-filen; din AI kan nu synkronisere klassifikationerne.";
            }
            catch (Exception ex) { StatusText.Text = ex.Message; }
            finally { SetBusy(false); }
        }

        private async void Clone_Click(object sender, RoutedEventArgs e)
        {
            var template = ProjectsComboBox.SelectedItem as ProjectChoice;
            string name = CloneNameTextBox.Text.Trim();
            if (template == null || verifiedKey == null) return;
            if (name.Length == 0) { StatusText.Text = "Skriv navnet på det nye projekt først."; return; }
            SetBusy(true);
            try
            {
                StatusText.Text = "Opretter projektkopien i NBS…";
                var result = await Request(verifiedKey, "/projects/" + template.Id + "?project_name=" + Uri.EscapeDataString(name), true);
                string id = result is JObject obj ? (string)(obj["id"] ?? obj["project"]?["id"]) : null;
                if (!await LoadProjects(id))
                {
                    StatusText.Text = "NBS har modtaget oprettelsen, men listen kunne ikke genindlæses. " + StatusText.Text + " Kontrollér projektlisten før et nyt forsøg.";
                    return;
                }
                StatusText.Text = "NBS har modtaget oprettelsen. Vælg det nye projekt og tryk Forbind projekt. Kontrollér listen før et nyt forsøg.";
            }
            catch (Exception ex) { StatusText.Text = ex.Message + " Kontrollér projektlisten før et nyt forsøg; oprettelsen kan være gennemført."; }
            finally { SetBusy(false); }
        }

        private void WhereDoIFindMyApiKey_Click(object sender, MouseButtonEventArgs e)
        {
            try { Process.Start(new ProcessStartInfo("https://support.nbsnordic.dk/article/138-hvor-finder-jeg-min-api-kode") { UseShellExecute = true }); }
            catch (Exception ex) { StatusText.Text = ex.Message; }
        }
    }
}
