namespace AeMcpSetup.Core;

/// <summary>A Claude Desktop install, with its config paths.</summary>
public sealed record ClaudeDesktopInstall(string AppName, string Path, string ConfigDir, string ConfigPath);

/// <summary>Detects a Claude Desktop install (macOS only).</summary>
public static class ClaudeDiscovery
{
    public const string ClaudeAppName = "Claude.app";

    /// <summary>Directory holding Claude Desktop's config on macOS.</summary>
    public static string ClaudeConfigDir(string? homeDir = null)
    {
        homeDir ??= Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        return Path.Combine(homeDir, "Library", "Application Support", "Claude");
    }

    /// <summary>
    /// Detects a Claude Desktop install at <paramref name="applicationsDir"/>.
    /// Returns null when <c>Claude.app</c> is absent. The config paths are derived
    /// from <paramref name="homeDir"/> without requiring the config file to exist.
    /// </summary>
    public static ClaudeDesktopInstall? DiscoverClaudeDesktop(
        string applicationsDir = "/Applications",
        string? homeDir = null)
    {
        var appPath = Path.Combine(applicationsDir, ClaudeAppName);
        if (!Directory.Exists(appPath) && !File.Exists(appPath))
        {
            return null;
        }

        var configDir = ClaudeConfigDir(homeDir);
        return new ClaudeDesktopInstall(
            "Claude",
            appPath,
            configDir,
            Path.Combine(configDir, "claude_desktop_config.json"));
    }
}
