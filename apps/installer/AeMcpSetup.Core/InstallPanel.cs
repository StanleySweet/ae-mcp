namespace AeMcpSetup.Core;

/// <summary>
/// Installs the Claude panel (<c>ae-mcp-panel.jsx</c>) into
/// <c>&lt;AE app folder&gt;/Scripts/ScriptUI Panels</c>, where After Effects lists it under Window.
/// The write goes through <see cref="InstallLoader.InstallFileAsync"/>, so it gets the same
/// idempotence and admin-elevation fallback as the startup loader.
/// </summary>
public static class InstallPanel
{
    public const string PanelFileName = "ae-mcp-panel.jsx";
    public const string CheckName = "bridge_panel";

    /// <summary><c>&lt;AE app folder&gt;/Scripts/ScriptUI Panels</c>.</summary>
    public static string PanelDir(AeInstall install)
        => Path.Combine(Path.GetDirectoryName(install.Path)!, "Scripts", "ScriptUI Panels");

    /// <summary>Full path of the panel file for <paramref name="install"/>.</summary>
    public static string PanelPath(AeInstall install, string? fileName = null)
        => Path.Combine(PanelDir(install), fileName ?? PanelFileName);

    /// <summary>Installs the panel. Never throws: failures come back as a <c>fail</c> row.</summary>
    public static Task<InstallLoaderResult> InstallAsync(
        AeInstall install,
        string panel,
        string? fileName = null,
        ElevatedWrite? elevatedWrite = null)
    {
        var name = fileName ?? PanelFileName;
        return InstallLoader.InstallFileAsync(
            PanelPath(install, name), panel, CheckName, name, "the Claude panel", elevatedWrite);
    }
}
