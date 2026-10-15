using AeMcpSetup.Core;

namespace AeMcpSetup.Core.Tests;

public class EnvironmentTests
{
    [Fact]
    public async Task ReportsAeInstallsAndClaudeDesktopTogether()
    {
        var applicationsDir = TempDir.Create("ae-mcp-apps-");
        var homeDir = TempDir.Create("ae-mcp-home-");
        Directory.CreateDirectory(Path.Combine(applicationsDir, "Adobe After Effects 2026.app"));
        Directory.CreateDirectory(Path.Combine(applicationsDir, "Claude.app"));

        var env = await EnvironmentDetector.DetectEnvironmentAsync(applicationsDir, homeDir);

        var only = Assert.Single(env.AfterEffects);
        Assert.Equal("Adobe After Effects 2026", only.AppName);
        Assert.Equal(2026, only.Year);
        Assert.Equal(Path.Combine(applicationsDir, "Adobe After Effects 2026.app"), only.Path);
        Assert.NotNull(env.ClaudeDesktop);
        Assert.Equal(Path.Combine(applicationsDir, "Claude.app"), env.ClaudeDesktop.Path);
    }

    [Fact]
    public async Task ReturnsEmptyInstallsAndNullClaudeWhenNothingIsInstalled()
    {
        var applicationsDir = TempDir.Create("ae-mcp-apps-");
        var homeDir = TempDir.Create("ae-mcp-home-");

        var env = await EnvironmentDetector.DetectEnvironmentAsync(applicationsDir, homeDir);

        Assert.Empty(env.AfterEffects);
        Assert.Null(env.ClaudeDesktop);
    }
}
