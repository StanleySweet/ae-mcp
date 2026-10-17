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

    private static string ManualInstructions(string path, string fileName, string what)
        => string.Join(' ',
            $"Setup could not write {path}.",
            $"Approve the administrator prompt, or install {what} by hand:",
            "open the folder above in Finder (Go > Go to Folder),",
            $"copy {fileName} there, then quit and reopen After Effects.");

    /// <summary>
    /// Installs the startup loader, writing directly when allowed and retrying
    /// with admin elevation on a permission error. Returns a <c>{check, status,
    /// fix}</c> row; a manual fallback string accompanies failures.
    /// </summary>
    public static Task<InstallLoaderResult> InstallAsync(
        AeInstall install,
        string loader,
        string? fileName = null,
        ElevatedWrite? elevatedWrite = null)
    {
        var name = fileName ?? LoaderFileName;
        var path = Path.Combine(LoaderStartupDir(install), name);
        return InstallFileAsync(path, loader, "bridge_loader", name, "the loader", elevatedWrite);
    }

    /// <summary>
    /// Writes <paramref name="contents"/> to <paramref name="path"/>, skipping an identical
    /// file, with the same admin-elevation fallback as the loader. <paramref name="check"/>
    /// names the result row; <paramref name="what"/> reads in the fix hint.
    /// </summary>
    public static async Task<InstallLoaderResult> InstallFileAsync(
        string path,
        string contents,
        string check,
        string fileName,
        string what,
        ElevatedWrite? elevatedWrite = null)
    {
        var previous = await Io.ReadFileOrNullAsync(path);
        if (previous == contents)
        {
            return new InstallLoaderResult(check, "ok", false, path);
        }

        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            await File.WriteAllTextAsync(path, contents);
            return new InstallLoaderResult(check, "ok", true, path);
        }
        catch (Exception error) when (IsPermissionError(error))
        {
            var elevate = elevatedWrite ?? OsascriptElevatedWriteAsync;
            if (await elevate(path, contents))
            {
                return new InstallLoaderResult(check, "ok", true, path);
            }

            return Failed(check, path, fileName, what);
        }
        catch
        {
            return Failed(check, path, fileName, what);
        }
    }

    private static InstallLoaderResult Failed(string check, string path, string fileName, string what)
        => new(
            check, "fail", false, path,
            $"Install {what} at {path} with an administrator, then reopen After Effects.",
            Manual: ManualInstructions(path, fileName, what));
}
