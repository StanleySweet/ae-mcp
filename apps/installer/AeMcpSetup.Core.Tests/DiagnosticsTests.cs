using AeMcpSetup.Core;

namespace AeMcpSetup.Core.Tests;

public class DiagnosticsTests
{
    [Fact]
    public void ListsAeInstallsClaudeDesktopAndRuntimeDetails()
    {
        var environment = new DetectedEnvironment(
            [new AeInstall("Adobe After Effects 2026", 2026, "/Applications/AE.app")],
            new ClaudeDesktopInstall("Claude", "/Applications/Claude.app", "/cfg", "/cfg/c.json"));

        var report = Diagnostics.Format(
            environment,
            new DateTimeOffset(2026, 10, 12, 0, 0, 0, TimeSpan.Zero),
            "darwin",
            "arm64",
            "10.0.0");

        Assert.Contains("Generated: 2026-10-12T00:00:00.000Z", report);
        Assert.Contains("Platform: darwin (arm64)", report);
        Assert.Contains(".NET: 10.0.0", report);
        Assert.Contains("- Adobe After Effects 2026 (2026) /Applications/AE.app", report);
        Assert.Contains("- /Applications/Claude.app", report);
    }

    [Fact]
    public void MarksMissingAfterEffectsAndClaude()
    {
        var report = Diagnostics.Format(
            new DetectedEnvironment([], null),
            new DateTimeOffset(2026, 10, 12, 0, 0, 0, TimeSpan.Zero));

        Assert.Contains("(none found)", report);
        Assert.Contains("(not found)", report);
    }
}
