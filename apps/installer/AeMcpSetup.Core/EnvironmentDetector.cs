namespace AeMcpSetup.Core;

/// <summary>Every AE install plus Claude Desktop, for the Setup checklist.</summary>
public sealed record DetectedEnvironment(
    IReadOnlyList<AeInstall> AfterEffects,
    ClaudeDesktopInstall? ClaudeDesktop);

/// <summary>Detects the machine's After Effects installs and Claude Desktop in one call.</summary>
public static class EnvironmentDetector
{
    public static Task<DetectedEnvironment> DetectEnvironmentAsync(
        string applicationsDir = "/Applications",
        string? homeDir = null)
    {
        var afterEffects = AeDiscovery.DiscoverAeVersions(applicationsDir);
        var claudeDesktop = ClaudeDiscovery.DiscoverClaudeDesktop(applicationsDir, homeDir);
        return Task.FromResult(new DetectedEnvironment(afterEffects, claudeDesktop));
    }
}
