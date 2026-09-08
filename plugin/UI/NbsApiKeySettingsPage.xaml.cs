using System;
using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

namespace revit_mcp_plugin.UI
{
    /// <summary>
    /// Interaction logic for NbsApiKeySettingsPage.xaml
    /// </summary>
    public partial class NbsApiKeySettingsPage : Page
    {
        private const string ApiKeyDocsUrl = "https://support.nbsnordic.dk/article/138-hvor-finder-jeg-min-api-kode";

        private bool isPasswordVisible = false;
        private string currentApiKey = string.Empty;

        public NbsApiKeySettingsPage()
        {
            InitializeComponent();
            DetectCurrentSettings();

            EnvVarRadio.IsChecked = true;
        }

        private void DetectCurrentSettings()
        {
            string envKey = Environment.GetEnvironmentVariable("NBS_API_KEY");
            string envProjectId = Environment.GetEnvironmentVariable("NBS_PROJECT_ID");
            string filePath = GetApiKeyFilePath();
            string fileKey = null;
            string fileProjectId = null;

            if (File.Exists(filePath))
            {
                try
                {
                    var lines = File.ReadAllLines(filePath);
                    if (lines.Length > 0) fileKey = lines[0].Trim();
                    if (lines.Length > 1) fileProjectId = lines[1].Trim();
                    if (string.IsNullOrEmpty(fileKey)) fileKey = null;
                }
                catch
                {
                    fileKey = null;
                }
            }

            if (!string.IsNullOrEmpty(envKey))
            {
                StatusText.Text = "Configured";
                StatusText.Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#4CAF50"));
                StatusSourceText.Text = "(from environment variable)";
                EnvVarRadio.IsChecked = true;
                ProjectIdTextBox.Text = envProjectId ?? string.Empty;
                currentApiKey = envKey;
                ApiKeyPasswordBox.Password = envKey;
                ApiKeyTextBox.Text = envKey;
            }
            else if (!string.IsNullOrEmpty(fileKey))
            {
                StatusText.Text = "Configured";
                StatusText.Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#4CAF50"));
                StatusSourceText.Text = "(from file)";
                FileRadio.IsChecked = true;
                ProjectIdTextBox.Text = fileProjectId ?? string.Empty;
                currentApiKey = fileKey;
                ApiKeyPasswordBox.Password = fileKey;
                ApiKeyTextBox.Text = fileKey;
            }
            else
            {
                StatusText.Text = "Not configured";
                StatusText.Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#F44336"));
                StatusSourceText.Text = string.Empty;
            }
        }

        private static string GetApiKeyFilePath()
        {
            string userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            return Path.Combine(userProfile, ".claude", "nbs_api_key.txt");
        }

        private void ToggleVisibilityButton_Click(object sender, RoutedEventArgs e)
        {
            isPasswordVisible = !isPasswordVisible;

            if (isPasswordVisible)
            {
                ApiKeyTextBox.Text = currentApiKey;
                ApiKeyPasswordBox.Visibility = Visibility.Collapsed;
                ApiKeyTextBox.Visibility = Visibility.Visible;
                ToggleVisibilityButton.Content = "Hide";
            }
            else
            {
                ApiKeyPasswordBox.Password = currentApiKey;
                ApiKeyTextBox.Visibility = Visibility.Collapsed;
                ApiKeyPasswordBox.Visibility = Visibility.Visible;
                ToggleVisibilityButton.Content = "Show";
            }
        }

        private void ApiKeyPasswordBox_PasswordChanged(object sender, RoutedEventArgs e)
        {
            currentApiKey = ApiKeyPasswordBox.Password;
        }

        private void ApiKeyTextBox_TextChanged(object sender, TextChangedEventArgs e)
        {
            currentApiKey = ApiKeyTextBox.Text;
        }

        private void WhereDoIFindMyApiKey_Click(object sender, MouseButtonEventArgs e)
        {
            try
            {
                Process.Start(new ProcessStartInfo(ApiKeyDocsUrl) { UseShellExecute = true });
            }
            catch
            {
                // Best-effort — do not crash the settings page if no default browser is registered.
            }
        }

        private void SaveButton_Click(object sender, RoutedEventArgs e)
        {
            string apiKey = currentApiKey?.Trim();
            string projectId = ProjectIdTextBox.Text?.Trim() ?? string.Empty;

            if (string.IsNullOrEmpty(apiKey))
            {
                MessageBox.Show("Please enter an API key.", "Missing API Key",
                    MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            try
            {
                if (EnvVarRadio.IsChecked == true)
                {
                    Environment.SetEnvironmentVariable("NBS_API_KEY", apiKey, EnvironmentVariableTarget.User);
                    Environment.SetEnvironmentVariable("NBS_PROJECT_ID", projectId, EnvironmentVariableTarget.User);
                    MessageBox.Show(
                        "NBS Nordic settings saved to environment variables NBS_API_KEY / NBS_PROJECT_ID.\nA Revit restart may be needed for changes to take effect.",
                        "Settings Saved", MessageBoxButton.OK, MessageBoxImage.Information);
                }
                else if (FileRadio.IsChecked == true)
                {
                    string filePath = GetApiKeyFilePath();
                    string directory = Path.GetDirectoryName(filePath);
                    if (!Directory.Exists(directory))
                    {
                        Directory.CreateDirectory(directory);
                    }
                    File.WriteAllLines(filePath, new[] { apiKey, projectId });
                    MessageBox.Show(
                        $"NBS Nordic settings saved to {filePath}.\nA Revit restart may be needed for changes to take effect.",
                        "Settings Saved", MessageBoxButton.OK, MessageBoxImage.Information);
                }

                DetectCurrentSettings();
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Failed to save NBS Nordic settings: {ex.Message}", "Error",
                    MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }
    }
}
