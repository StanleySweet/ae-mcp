using System.Runtime.InteropServices;

namespace AeMcpSetup.Core;

/// <summary>Builds the plain-text diagnostics report the Setup app exports for support.</summary>
public static class Diagnostics
{
    /// <summary>
    /// The detected environment plus runtime details. Pure and deterministic when
    /// <paramref name="now"/>, <paramref name="platform"/> and
    /// <paramref name="arch"/> are supplied.
    /// </summary>
    public static string Format(
        DetectedEnvironment environment,
        DateTimeOffset? now = null,
        string? platform = null,
        string? arch = null,
        string? runtimeVersion = null)
    {
        var iso = (now ?? DateTimeOffset.UtcNow).UtcDateTime.ToString("yyyy-MM-ddTHH:mm:ss.fffZ");
        var lines = new List<string>
        {
            "AE-MCP diagnostics",
            $"Generated: {iso}",
            $"Platform: {platform ?? PlatformName()} ({arch ?? ArchName()})",
            $".NET: {runtimeVersion ?? Environment.Version.ToString()}",
            "",
            "After Effects:",
        };

        if (environment.AfterEffects.Count == 0)
        {
            lines.Add("  (none found)");
        }
        else
        {
            foreach (var install in environment.AfterEffects)
            {
                lines.Add($"  - {install.AppName} ({install.Year}) {install.Path}");
            }
        }

        var claude = environment.ClaudeDesktop;
        lines.Add("Claude Desktop:");
        lines.Add(claude is null ? "  (not found)" : $"  - {claude.Path}");
        return string.Join('\n', lines) + "\n";
    }

    private static string PlatformName()
        => RuntimeInformation.IsOSPlatform(OSPlatform.OSX) ? "darwin" : RuntimeInformation.OSDescription;

    private static string ArchName() => RuntimeInformation.ProcessArchitecture switch
    {
        Architecture.Arm64 => "arm64",
        Architecture.X64 => "x64",
        var other => other.ToString().ToLowerInvariant(),
    };
}
