using AeMcpSetup.Core;

namespace AeMcpSetup.Core.Tests;

public class RepairUninstallTests
{
    private const string Payload = "var AEMCP_BRIDGE_VERSION = \"1.0.0\";";
    private const string Loader = "var AEMCP_LOADER = true;";

    private static (AeInstall Install, string Folder) FakeInstall()
    {
        var folder = TempDir.Create("ae-mcp-ae-");
        const string appName = "Adobe After Effects 2026";
        var appPath = Path.Combine(folder, $"{appName}.app");
        Directory.CreateDirectory(appPath);
        return (new AeInstall(appName, 2026, appPath), folder);
    }

    [Fact]
    public async Task RepairReinstallsThePayloadAndTheLoader()
    {
        var root = TempDir.Create("ae-mcp-home-");
        var (install, folder) = FakeInstall();

        var result = await RepairUninstall.RepairAsync(root, install, Payload, Loader);

        Assert.True(result.Ok);
        Assert.Equal(
            [("bridge_payload", "ok"), ("bridge_loader", "ok")],
            result.Checks.Select(c => (c.Check, c.Status)));
        Assert.Equal(Payload, await File.ReadAllTextAsync(Path.Combine(root, "bridge", "current.jsx")));
        Assert.Equal(Loader, await File.ReadAllTextAsync(Path.Combine(folder, "Scripts", "Startup", "ae-mcp-loader.jsx")));
    }

    [Fact]
    public async Task RepairReportsNotOkWhenAStepFails()
    {
        var root = TempDir.Create("ae-mcp-home-");
        var (install, folder) = FakeInstall();
        await File.WriteAllTextAsync(Path.Combine(folder, "Scripts"), "blocked");

        var result = await RepairUninstall.RepairAsync(root, install, Payload, Loader);

        Assert.False(result.Ok);
        Assert.Equal("fail", result.Checks.First(c => c.Check == "bridge_loader").Status);
    }

    [Fact]
    public async Task UninstallRemovesThePayloadBridgeFolderAndLoader()
    {
        var root = TempDir.Create("ae-mcp-home-");
        var (install, folder) = FakeInstall();
        await RepairUninstall.RepairAsync(root, install, Payload, Loader);

        var result = await RepairUninstall.UninstallAsync(root, install);

        Assert.Equal("uninstall", result.Check);
        Assert.Equal("ok", result.Status);
        Assert.Equal(2, result.Removed.Count);
        Assert.False(Directory.Exists(Path.Combine(root, "bridge")));
        Assert.False(File.Exists(Path.Combine(folder, "Scripts", "Startup", "ae-mcp-loader.jsx")));
    }

    [Fact]
    public async Task UninstallIsIdempotentWhenNothingIsInstalled()
    {
        var root = TempDir.Create("ae-mcp-home-");
        var (install, _) = FakeInstall();

        var result = await RepairUninstall.UninstallAsync(root, install);

        Assert.Equal("ok", result.Status);
        Assert.Empty(result.Removed);
    }
}
