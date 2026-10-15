using System.Text.RegularExpressions;

namespace AeMcpSetup.Core;

/// <summary>An After Effects install found under <c>/Applications</c>.</summary>
public sealed record AeInstall(string AppName, int Year, string Path);

/// <summary>Lists After Effects installs, newest first (macOS only).</summary>
public static partial class AeDiscovery
{
    public const int MinSupportedAeYear = 2025;

    [GeneratedRegex(@"^Adobe After Effects (\d{4})\.app$")]
    private static partial Regex AeAppPattern();

    [GeneratedRegex(@"^Adobe After Effects (\d{4})$")]
    private static partial Regex AeFolderPattern();

    /// <summary>
    /// Lists After Effects installs at <paramref name="applicationsDir"/>, newest
    /// first. Handles both layouts: <c>/Applications/Adobe After Effects 2026.app</c>
    /// and the versioned folder layout.
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
        return installs;
    }
}
