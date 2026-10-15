namespace AeMcpSetup.Core;

/// <summary>A third-party extension installed for After Effects (a CEP bundle).</summary>
public sealed record AeExtension(string Name, string Path, string Scope);

/// <summary>Lists the CEP extensions installed for After Effects (macOS).</summary>
public static class AeExtensions
{
    /// <summary>CEP scans this per-user folder for extensions.</summary>
    public const string CepUserSubdir = "Library/Application Support/Adobe/CEP/extensions";

    /// <summary>…and this system-wide folder.</summary>
    public const string CepSystemDir = "/Library/Application Support/Adobe/CEP/extensions";

    /// <summary>
    /// Lists the After Effects extensions installed on the machine: the per-user
    /// CEP folder plus the system-wide one. Each extension is a folder. Missing
    /// folders are not an error.
    /// </summary>
    public static IReadOnlyList<AeExtension> DiscoverAeExtensions(
        string? homeDir = null,
        string? systemDir = null)
    {
        homeDir ??= Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var dirs = new (string Dir, string Scope)[]
        {
            (Path.Combine(homeDir, CepUserSubdir), "user"),
            (systemDir ?? CepSystemDir, "system"),
        };

        var extensions = new List<AeExtension>();
        foreach (var (dir, scope) in dirs)
        {
            if (!Directory.Exists(dir))
            {
                continue;
            }

            foreach (var entry in Directory.GetDirectories(dir))
            {
                var name = Path.GetFileName(entry);
                extensions.Add(new AeExtension(name, entry, scope));
            }
        }

        extensions.Sort((a, b) => string.CompareOrdinal(a.Name, b.Name));
        return extensions;
    }
}
