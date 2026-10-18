using System.Text.RegularExpressions;

namespace AeMcpSetup.Core;

/// <summary>
/// An After Effects install found under <c>/Applications</c>. <see cref="Beta"/> marks
/// <c>Adobe After Effects (Beta)</c>; its <see cref="Year"/> is the major version from
/// Info.plist + 2000, or the newest stable year + 1 when that is unreadable.
/// </summary>
public sealed record AeInstall(string AppName, int Year, string Path, bool Beta = false);

/// <summary>Lists After Effects installs: stable newest first, then the beta (macOS only).</summary>
public static partial class AeDiscovery
{
    public const int MinSupportedAeYear = 2025;

    public const string BetaAppName = "Adobe After Effects (Beta)";

    [GeneratedRegex(@"^Adobe After Effects (\d{4})\.app$")]
    private static partial Regex AeAppPattern();

    [GeneratedRegex(@"^Adobe After Effects (\d{4})$")]
    private static partial Regex AeFolderPattern();

    [GeneratedRegex(@"^Adobe After Effects \(Beta\)\.app$")]
    private static partial Regex AeBetaAppPattern();

    [GeneratedRegex(@"^Adobe After Effects \(Beta\)$")]
    private static partial Regex AeBetaFolderPattern();

    [GeneratedRegex(@"<key>CFBundleShortVersionString</key>\s*<string>\s*(\d+)")]
    private static partial Regex ShortVersionPattern();

    /// <summary>
    /// Lists After Effects installs at <paramref name="applicationsDir"/>: stable
    /// installs newest first, then the beta. Handles both layouts:
    /// <c>/Applications/Adobe After Effects 2026.app</c> and the versioned folder layout.
    /// </summary>
    public static IReadOnlyList<AeInstall> DiscoverAeVersions(string applicationsDir = "/Applications")
    {
        string[] entries;
        try
        {
            entries = Directory.GetFileSystemEntries(applicationsDir);
        }
        catch
        {
            return [];
        }

        var installs = new List<AeInstall>();
        string? betaPath = null;
        foreach (var fullPath in entries)
        {
            var name = Path.GetFileName(fullPath);

            var direct = AeAppPattern().Match(name);
            if (direct.Success)
            {
                var year = int.Parse(direct.Groups[1].Value);
                if (year >= MinSupportedAeYear)
                {
                    installs.Add(new AeInstall(name[..^".app".Length], year, fullPath));
                }
                continue;
            }

            if (AeBetaAppPattern().IsMatch(name))
            {
                betaPath ??= fullPath;
                continue;
            }

            if (AeBetaFolderPattern().IsMatch(name))
            {
                var betaAppPath = Path.Combine(fullPath, $"{name}.app");
                if (Directory.Exists(betaAppPath))
                {
                    betaPath ??= betaAppPath;
                }
                continue;
            }

            var folder = AeFolderPattern().Match(name);
            if (!folder.Success)
            {
                continue;
            }

            var folderYear = int.Parse(folder.Groups[1].Value);
            if (folderYear < MinSupportedAeYear)
            {
                continue;
            }

            var appPath = Path.Combine(applicationsDir, name, $"{name}.app");
            if (Directory.Exists(appPath))
            {
                installs.Add(new AeInstall(name, folderYear, appPath));
            }
        }

        installs.Sort((a, b) => b.Year.CompareTo(a.Year));
        if (betaPath is not null)
        {
            var newestStable = installs.Count > 0 ? installs[0].Year : MinSupportedAeYear - 1;
            var major = BetaMajorVersion(betaPath);
            var betaYear = major is int version ? version + 2000 : newestStable + 1;
            installs.Add(new AeInstall(BetaAppName, betaYear, betaPath, Beta: true));
        }

        return installs;
    }

    /// <summary>Major version from the bundle's Info.plist (<c>27.1.0</c> gives 27), or null when unreadable.</summary>
    private static int? BetaMajorVersion(string appPath)
    {
        try
        {
            var plist = File.ReadAllText(Path.Combine(appPath, "Contents", "Info.plist"));
            var match = ShortVersionPattern().Match(plist);
            return match.Success && int.TryParse(match.Groups[1].Value, out var major) && major > 0
                ? major
                : null;
        }
        catch
        {
            return null;
        }
    }
}
