namespace AeMcpSetup.Core;

/// <summary>
/// Installs the Claude panel (<c>Claude for After Effects.jsx</c>) into
/// <c>&lt;AE app folder&gt;/Scripts/ScriptUI Panels</c>, where After Effects lists it under Window.
/// The write goes through <see cref="InstallLoader.InstallFileAsync"/>, so it gets the same
/// idempotence and admin-elevation fallback as the startup loader. The panel used to be named
/// <c>ae-mcp-panel.jsx</c>; install removes that old file so the Window menu lists one panel (ADR-0012).
/// </summary>
public static class InstallPanel
{
    public const string PanelFileName = "Claude for After Effects.jsx";
    public const string LegacyPanelFileName = "ae-mcp-panel.jsx";
    public const string CheckName = "bridge_panel";

    /// <summary><c>&lt;AE app folder&gt;/Scripts/ScriptUI Panels</c>.</summary>
    public static string PanelDir(AeInstall install)
        => Path.Combine(Path.GetDirectoryName(install.Path)!, "Scripts", "ScriptUI Panels");

    /// <summary>Full path of the panel file for <paramref name="install"/>.</summary>
    public static string PanelPath(AeInstall install, string? fileName = null)
        => Path.Combine(PanelDir(install), fileName ?? PanelFileName);

    /// <summary>
    /// Installs the panel and removes the legacy <c>ae-mcp-panel.jsx</c> after a successful write.
    /// Never throws: failures come back as a <c>fail</c> row.
    /// </summary>
    public static async Task<InstallLoaderResult> InstallAsync(
        AeInstall install,
        string panel,
        string? fileName = null,
        ElevatedWrite? elevatedWrite = null)
    {
        var name = fileName ?? PanelFileName;
        var result = await InstallLoader.InstallFileAsync(
            PanelPath(install, name), panel, CheckName, name, "the Claude panel", elevatedWrite);
        if (result.IsOk && fileName is null)
        {
            RemoveLegacyPanel(install);
        }

        return result;
    }

    /// <summary>
    /// Deletes the legacy panel file if it is there. Best effort: a folder that needs
    /// administrator rights keeps the old file, and the next install retries.
    /// </summary>
    public static void RemoveLegacyPanel(AeInstall install)
    {
        try
        {
            var legacy = PanelPath(install, LegacyPanelFileName);
            if (File.Exists(legacy))
            {
                File.Delete(legacy);
            }
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            // keep the old file; the panel still works
        }
    }
}
