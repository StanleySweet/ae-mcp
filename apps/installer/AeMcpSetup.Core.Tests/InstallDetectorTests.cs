using AeMcpSetup.Core;

namespace AeMcpSetup.Core.Tests;

public class InstallDetectorTests
{
    private const string Bundled = "var AEMCP_BRIDGE_VERSION = \"2.0.0\";";
    private const string Loader = "var AEMCP_LOADER = true;";

    private static AeInstall FakeInstall()
    {
        var folder = TempDir.Create("ae-mcp-ae-");
        var appPath = Path.Combine(folder, "Adobe After Effects 2026.app");
        Directory.CreateDirectory(appPath);
        return new AeInstall("Adobe After Effects 2026", 2026, appPath);
    }

    private static async Task WriteLoaderAsync(AeInstall install)
    {
        Directory.CreateDirectory(InstallLoader.LoaderStartupDir(install));
        await File.WriteAllTextAsync(
            Path.Combine(InstallLoader.LoaderStartupDir(install), InstallLoader.LoaderFileName), Loader);
    }

    [Fact]
    public async Task AnEmptyMachineIsAFreshInstall()
    {
        var root = TempDir.Create("ae-mcp-root-");

        var state = await InstallDetector.DetectAsync(root, FakeInstall(), Bundled);

        Assert.Equal(InstallKind.Fresh, state.Kind);
        Assert.Equal("Fresh install", InstallDetector.Describe(state));
    }

    [Fact]
    public async Task AnOlderPayloadIsAnUpdateFromItsVersion()
    {
        var root = TempDir.Create("ae-mcp-root-");
        await InstallPayload.InstallAsync(root, "var AEMCP_BRIDGE_VERSION = \"1.0.0\";");
        var install = FakeInstall();
        await WriteLoaderAsync(install);

        var state = await InstallDetector.DetectAsync(root, install, Bundled);

        Assert.Equal(InstallKind.Update, state.Kind);
        Assert.Equal("1.0.0", state.From);
        Assert.Equal("2.0.0", state.To);
        Assert.Equal("Update from 1.0.0 to 2.0.0. Restart Claude Desktop too.", InstallDetector.Describe(state));
    }

    [Fact]
    public async Task AMatchingPayloadWithTheLoaderIsUpToDate()
    {
        var root = TempDir.Create("ae-mcp-root-");
        await InstallPayload.InstallAsync(root, Bundled);
        var install = FakeInstall();
        await WriteLoaderAsync(install);

        var state = await InstallDetector.DetectAsync(root, install, Bundled);

        Assert.Equal(InstallKind.UpToDate, state.Kind);
        Assert.Equal("Up to date", InstallDetector.Describe(state));
    }

    [Fact]
    public async Task AMatchingPayloadWithoutTheLoaderIsStillAFreshInstall()
    {
        var root = TempDir.Create("ae-mcp-root-");
        await InstallPayload.InstallAsync(root, Bundled);

        var state = await InstallDetector.DetectAsync(root, FakeInstall(), Bundled);

        Assert.Equal(InstallKind.Fresh, state.Kind);
    }

    [Fact]
    public async Task ALoaderWithoutAPayloadIsAnUpdateToTheBundledVersion()
    {
        var install = FakeInstall();
        await WriteLoaderAsync(install);

        var state = await InstallDetector.DetectAsync(TempDir.Create("ae-mcp-root-"), install, Bundled);

        Assert.Equal(InstallKind.Update, state.Kind);
        Assert.Null(state.From);
        Assert.Equal("Update to 2.0.0. Restart Claude Desktop too.", InstallDetector.Describe(state));
    }
}
