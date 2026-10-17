using AeMcpSetup.Core;

namespace AeMcpSetup.Core.Tests;

public class InstallPanelTests
{
    private const string Panel = "var AEMCP_PANEL = true;";

    private static (AeInstall Install, string Folder) FakeInstall()
    {
        var folder = TempDir.Create("ae-mcp-ae-");
        const string appName = "Adobe After Effects 2026";
        var appPath = Path.Combine(folder, $"{appName}.app");
        Directory.CreateDirectory(appPath);
        return (new AeInstall(appName, 2026, appPath), folder);
    }

    [Fact]
    public void PanelDirIsTheScriptUIPanelsFolderNextToTheAppBundle()
    {
        var (install, folder) = FakeInstall();
        Assert.Equal(Path.Combine(folder, "Scripts", "ScriptUI Panels"), InstallPanel.PanelDir(install));
    }

    [Fact]
    public async Task WritesThePanelIntoScriptUIPanels()
    {
        var (install, folder) = FakeInstall();

        var result = await InstallPanel.InstallAsync(install, Panel);

        Assert.Equal("bridge_panel", result.Check);
        Assert.Equal("ok", result.Status);
        Assert.True(result.Changed);
        var expected = Path.Combine(folder, "Scripts", "ScriptUI Panels", "ae-mcp-panel.jsx");
        Assert.Equal(expected, result.Path);
        Assert.Equal(Panel, await File.ReadAllTextAsync(expected));
    }

    [Fact]
    public async Task IsIdempotentOnASecondRun()
    {
        var (install, _) = FakeInstall();

        await InstallPanel.InstallAsync(install, Panel);
        var second = await InstallPanel.InstallAsync(install, Panel);

        Assert.Equal("ok", second.Status);
        Assert.False(second.Changed);
    }

    [Fact]
    public async Task FailsWithAManualFallbackNamingThePanelWhenTheFolderIsBlocked()
    {
        var (install, folder) = FakeInstall();
        Directory.CreateDirectory(Path.Combine(folder, "Scripts"));
        await File.WriteAllTextAsync(Path.Combine(folder, "Scripts", "ScriptUI Panels"), "a file blocks the folder");

        var result = await InstallPanel.InstallAsync(install, Panel, elevatedWrite: (_, _) => Task.FromResult(false));

        Assert.Equal("fail", result.Status);
        Assert.Contains("the Claude panel", result.Fix);
        Assert.Contains("ae-mcp-panel.jsx", result.Manual);
        Assert.DoesNotContain("loader", result.Manual);
    }

    [Fact]
    public async Task ElevatesWhenTheFolderNeedsAdminRights()
    {
        var (install, folder) = FakeInstall();
        Directory.CreateDirectory(Path.Combine(folder, "Scripts"));
        await File.WriteAllTextAsync(Path.Combine(folder, "Scripts", "ScriptUI Panels"), "a file blocks the folder");
        string? elevatedPath = null;

        var result = await InstallPanel.InstallAsync(install, Panel, elevatedWrite: (path, _) =>
        {
            elevatedPath = path;
            return Task.FromResult(true);
        });

        // The blocked folder raises a non-permission IO error, so the elevation path is not taken.
        Assert.Equal("fail", result.Status);
        Assert.Null(elevatedPath);
    }
}
