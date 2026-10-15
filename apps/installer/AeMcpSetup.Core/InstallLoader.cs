namespace AeMcpSetup.Core;

public sealed record InstallLoaderResult(
    string Check,
    string Status,
    bool Changed,
    string Path,
    string? Fix = null,
    bool? NeedsQuit = null,
    string? Manual = null) : InstallerCheck(Check, Status, Fix, NeedsQuit);

/// <summary>Writes <c>contents</c> to <c>path</c> with administrator rights. Returns success.</summary>
public delegate Task<bool> ElevatedWrite(string path, string contents);

/// <summary>Installs the startup loader at <c>&lt;AE folder&gt;/Scripts/Startup</c>.</summary>
public static class InstallLoader
{
    public const string LoaderFileName = "ae-mcp-loader.jsx";

    /// <summary><c>&lt;AE app folder&gt;/Scripts/Startup</c> — where AE runs startup scripts.</summary>
    public static string LoaderStartupDir(AeInstall install)
        => Path.Combine(Path.GetDirectoryName(install.Path)!, "Scripts", "Startup");

    private static string ShellQuote(string value) => $"'{value.Replace("'", "'\\''")}'";

    /// <summary>Shell command that copies <c>source</c> to <c>dest</c>, creating <c>dest</c>'s folder.</summary>
    public static string ElevatedCopyCommand(string source, string dest)
        => $"mkdir -p {ShellQuote(Path.GetDirectoryName(dest)!)} && cp {ShellQuote(source)} {ShellQuote(dest)}";

    /// <summary>Wraps a value as an AppleScript string literal, escaping <c>\</c> and <c>"</c>.</summary>
    public static string QuoteAppleScript(string value)
        => $"\"{value.Replace("\\", "\\\\").Replace("\"", "\\\"")}\"";

    /// <summary>
    /// The AppleScript that runs <paramref name="shellCommand"/> with admin rights.
    /// Must not go through <c>System.Text.Json</c>: its default encoder HTML-escapes
    /// <c>'</c> and <c>&amp;</c> to <c>\u0027</c>/<c>\u0026</c>, which AppleScript rejects
    /// with a syntax error (-2741) before the prompt ever appears.
    /// </summary>
    public static string ElevationScript(string shellCommand)
        => $"do shell script {QuoteAppleScript(shellCommand)} with administrator privileges";

    /// <summary>
    /// Default <see cref="ElevatedWrite"/>: stages the file in a temp dir, then
    /// copies it into place with <c>osascript ... with administrator privileges</c>.
    /// </summary>
    public static async Task<bool> OsascriptElevatedWriteAsync(string path, string contents)
    {
        var staging = Path.Combine(Path.GetTempPath(), $"ae-mcp-elevate-{Guid.NewGuid():N}");
        Directory.CreateDirectory(staging);
        var source = Path.Combine(staging, "ae-mcp-loader.jsx");
        await File.WriteAllTextAsync(source, contents);
        var script = ElevationScript(ElevatedCopyCommand(source, path));
        return await Shell.SucceedsAsync("osascript", ["-e", script]);
    }

    private static bool IsPermissionError(Exception error)
        => error is UnauthorizedAccessException;

    private static string ManualInstructions(string path)
        => string.Join(' ',
            $"Setup could not write {path}.",
            "Approve the administrator prompt, or install the loader by hand:",
            "open the folder above in Finder (Go > Go to Folder),",
            "copy ae-mcp-loader.jsx there, then quit and reopen After Effects.");

    /// <summary>
    /// Installs the startup loader, writing directly when allowed and retrying
    /// with admin elevation on a permission error. Returns a <c>{check, status,
    /// fix}</c> row; a manual fallback string accompanies failures.
    /// </summary>
    public static async Task<InstallLoaderResult> InstallAsync(
        AeInstall install,
        string loader,
        string? fileName = null,
        ElevatedWrite? elevatedWrite = null)
    {
        var path = Path.Combine(LoaderStartupDir(install), fileName ?? LoaderFileName);
        var previous = await Io.ReadFileOrNullAsync(path);
        if (previous == loader)
        {
            return new InstallLoaderResult("bridge_loader", "ok", false, path);
        }

        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            await File.WriteAllTextAsync(path, loader);
            return new InstallLoaderResult("bridge_loader", "ok", true, path);
        }
        catch (Exception error) when (IsPermissionError(error))
        {
            var elevate = elevatedWrite ?? OsascriptElevatedWriteAsync;
            if (await elevate(path, loader))
            {
                return new InstallLoaderResult("bridge_loader", "ok", true, path);
            }

            return new InstallLoaderResult(
                "bridge_loader", "fail", false, path,
                $"Install the loader at {path} with an administrator, then reopen After Effects.",
                Manual: ManualInstructions(path));
        }
        catch
        {
            return new InstallLoaderResult(
                "bridge_loader", "fail", false, path,
                $"Install the loader at {path} with an administrator, then reopen After Effects.",
                Manual: ManualInstructions(path));
        }
    }
}
