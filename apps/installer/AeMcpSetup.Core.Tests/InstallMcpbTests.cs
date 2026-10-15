using AeMcpSetup.Core;

namespace AeMcpSetup.Core.Tests;

public class InstallMcpbTests
{
    private static readonly ClaudeDesktopInstall Claude = new(
        "Claude",
        "/Applications/Claude.app",
        "/Users/example/Library/Application Support/Claude",
        "/Users/example/Library/Application Support/Claude/claude_desktop_config.json");

    private static string FakeMcpb()
    {
        var dir = TempDir.Create("ae-mcp-mcpb-");
        var path = Path.Combine(dir, "ae-mcp.mcpb");
        File.WriteAllText(path, "zip bytes");
        return path;
    }

    [Fact]
    public void ClaudeOpenArgsOpensTheBundleWithClaudeDesktop()
    {
        Assert.Equal(["-a", "Claude", "/tmp/ae-mcp.mcpb"], InstallMcpb.ClaudeOpenArgs("/tmp/ae-mcp.mcpb"));
    }

    [Fact]
    public async Task HandsTheBundleToClaudeDesktop()
    {
        var mcpbPath = FakeMcpb();
        string? opened = null;

        var result = await InstallMcpb.HandToClaudeAsync(mcpbPath, Claude, path =>
        {
            opened = path;
            return Task.FromResult(true);
        });

        Assert.Equal("claude_extension", result.Check);
        Assert.Equal("ok", result.Status);
        Assert.True(result.Handed);
        Assert.Equal(mcpbPath, result.Path);
        Assert.Equal(mcpbPath, opened);
    }

    [Fact]
    public async Task ReportsAFixWhenClaudeDesktopIsNotInstalled()
    {
        var opened = false;
        var result = await InstallMcpb.HandToClaudeAsync("/tmp/ae-mcp.mcpb", null, _ =>
        {
            opened = true;
            return Task.FromResult(true);
        });

        Assert.Equal("fail", result.Status);
        Assert.False(string.IsNullOrEmpty(result.Fix));
        Assert.False(opened);
    }

    [Fact]
    public async Task ReportsAFixWhenTheBundleIsMissing()
    {
        var opened = false;
        var result = await InstallMcpb.HandToClaudeAsync("/nope/ae-mcp.mcpb", Claude, _ =>
        {
            opened = true;
            return Task.FromResult(true);
        });

        Assert.Equal("fail", result.Status);
        Assert.False(string.IsNullOrEmpty(result.Fix));
        Assert.False(opened);
    }

    [Fact]
    public async Task ReportsAFixWhenClaudeDeclinesToOpenTheBundle()
    {
        var mcpbPath = FakeMcpb();
        var result = await InstallMcpb.HandToClaudeAsync(mcpbPath, Claude, _ => Task.FromResult(false));

        Assert.Equal("fail", result.Status);
        Assert.False(string.IsNullOrEmpty(result.Fix));
    }
}
