using AeMcpSetup.Core;

namespace AeMcpSetup.Core.Tests;

public class ClaudeDiscoveryTests
{
    [Fact]
    public void FindsClaudeAppAndComputesTheConfigPaths()
    {
        var applicationsDir = TempDir.Create("ae-mcp-apps-");
        var homeDir = TempDir.Create("ae-mcp-home-");
        Directory.CreateDirectory(Path.Combine(applicationsDir, "Claude.app"));

        var found = ClaudeDiscovery.DiscoverClaudeDesktop(applicationsDir, homeDir);

        Assert.NotNull(found);
        Assert.Equal("Claude", found.AppName);
        Assert.Equal(Path.Combine(applicationsDir, "Claude.app"), found.Path);
        Assert.Equal(Path.Combine(homeDir, "Library", "Application Support", "Claude"), found.ConfigDir);
        Assert.Equal(
            Path.Combine(homeDir, "Library", "Application Support", "Claude", "claude_desktop_config.json"),
            found.ConfigPath);
    }

    [Fact]
    public void ReturnsNullWhenClaudeAppIsNotInstalled()
    {
        var applicationsDir = TempDir.Create("ae-mcp-apps-");
        var homeDir = TempDir.Create("ae-mcp-home-");
        Directory.CreateDirectory(Path.Combine(applicationsDir, "Safari.app"));

        Assert.Null(ClaudeDiscovery.DiscoverClaudeDesktop(applicationsDir, homeDir));
    }

    [Fact]
    public void ReturnsNullWhenTheApplicationsDirectoryIsMissing()
    {
        var homeDir = TempDir.Create("ae-mcp-home-");
        Assert.Null(ClaudeDiscovery.DiscoverClaudeDesktop("/nope/not/here", homeDir));
    }

    [Fact]
    public void ConfigDirPointsAtTheClaudeConfigDirectoryUnderTheGivenHome()
    {
        Assert.Equal(
            Path.Combine("/Users/example", "Library", "Application Support", "Claude"),
            ClaudeDiscovery.ClaudeConfigDir("/Users/example"));
    }
}
