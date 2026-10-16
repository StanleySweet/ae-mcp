namespace AeMcpSetup.Core;

public enum InstallKind
{
    Fresh,
    Update,
    UpToDate,
}

/// <summary>
/// What is already on disk, compared with the bundled payload. <c>From</c> is the
/// installed bridge version (null when unstamped or absent); <c>To</c> is the bundled one.
/// </summary>
public sealed record InstallState(InstallKind Kind, string? From = null, string? To = null);

/// <summary>Tells a fresh install from an update of an existing one.</summary>
public static class InstallDetector
{
    /// <summary>
    /// Reads the installed payload version and whether the startup loader exists.
    /// Nothing on disk means <c>Fresh</c>; a matching version with the loader present
    /// means <c>UpToDate</c>; anything else is an <c>Update</c>.
    /// </summary>
    public static async Task<InstallState> DetectAsync(
        string root,
        AeInstall install,
        string bundledPayload,
        string? fileName = null)
    {
        var installedPayload = await Io.ReadFileOrNullAsync(Path.Combine(root, "bridge", "current.jsx"));
        var installed = installedPayload is null ? null : InstallPayload.PayloadVersion(installedPayload);
        var bundled = InstallPayload.PayloadVersion(bundledPayload);
        var loaderPresent = File.Exists(
            Path.Combine(InstallLoader.LoaderStartupDir(install), fileName ?? InstallLoader.LoaderFileName));

        if (installedPayload is null && !loaderPresent)
        {
            return new InstallState(InstallKind.Fresh, null, bundled);
        }

        if (installed is not null && installed == bundled)
        {
            // A matching payload without the loader still needs the loader written, which is a first install.
            return new InstallState(loaderPresent ? InstallKind.UpToDate : InstallKind.Fresh, installed, bundled);
        }

        return new InstallState(InstallKind.Update, installed, bundled);
    }

    /// <summary>The one-line status shown before Install.</summary>
    public static string Describe(InstallState state) => state.Kind switch
    {
        InstallKind.Fresh => "Fresh install",
        InstallKind.UpToDate => "Up to date",
        _ => string.Join(' ',
            $"Update{(state.From is null ? "" : $" from {state.From}")}{(state.To is null ? "" : $" to {state.To}")}.",
            "Restart Claude Desktop too."),
    };
}
