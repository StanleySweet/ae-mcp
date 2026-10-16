using AeMcpSetup.Core;

namespace AeMcpSetup.Core.Tests;

public class InstallVerifyTests
{
    private const string Payload = "var AEMCP_BRIDGE_VERSION = \"1.0.0\";";
    private const string Loader = "var AEMCP_LOADER = true;";

    private static AeInstall FakeInstall()
    {
        var folder = TempDir.Create("ae-mcp-ae-");
        var appPath = Path.Combine(folder, "Adobe After Effects 2026.app");
        Directory.CreateDirectory(appPath);
        return new AeInstall("Adobe After Effects 2026", 2026, appPath);
    }

    private static string LoaderFile(AeInstall install)
        => Path.Combine(InstallLoader.LoaderStartupDir(install), InstallLoader.LoaderFileName);

    [Fact]
    public async Task PayloadMatchesWhenTheInstalledFileIsIdentical()
    {
        var root = TempDir.Create("ae-mcp-root-");
        await InstallPayload.InstallAsync(root, Payload);

        var result = await InstallVerify.PayloadAsync(root, Payload);

        Assert.Equal("bridge_payload", result.Id);
        Assert.True(result.Ok);
        Assert.Null(result.Reason);
    }

    [Fact]
    public async Task PayloadIsNotOkWhenTheFileIsMissing()
    {
        var root = TempDir.Create("ae-mcp-root-");

        var result = await InstallVerify.PayloadAsync(root, Payload);

        Assert.False(result.Ok);
        Assert.Equal(InstallVerify.PayloadReason, result.Reason);
    }

    [Fact]
    public async Task PayloadIsNotOkWhenTheInstalledFileIsStale()
    {
        var root = TempDir.Create("ae-mcp-root-");
        await InstallPayload.InstallAsync(root, "var AEMCP_BRIDGE_VERSION = \"0.0.1\";");

        var result = await InstallVerify.PayloadAsync(root, Payload);

        Assert.False(result.Ok);
        Assert.Equal(InstallVerify.PayloadReason, result.Reason);
    }

    [Fact]
    public async Task LoaderMatchesWhenTheInstalledFileIsIdentical()
    {
        var install = FakeInstall();
        Directory.CreateDirectory(InstallLoader.LoaderStartupDir(install));
        await File.WriteAllTextAsync(LoaderFile(install), Loader);

        var result = await InstallVerify.LoaderAsync(install, Loader);

        Assert.Equal("bridge_loader", result.Id);
        Assert.True(result.Ok);
        Assert.Null(result.Reason);
    }

    [Fact]
    public async Task LoaderIsNotOkWhenTheFileIsMissing()
    {
        var install = FakeInstall();

        var result = await InstallVerify.LoaderAsync(install, Loader);

        Assert.False(result.Ok);
        Assert.Equal(InstallVerify.LoaderReason, result.Reason);
    }

    [Fact]
    public async Task LoaderIsNotOkWhenTheInstalledFileIsStale()
    {
        var install = FakeInstall();
        Directory.CreateDirectory(InstallLoader.LoaderStartupDir(install));
        await File.WriteAllTextAsync(LoaderFile(install), "var AEMCP_LOADER = false;");

        var result = await InstallVerify.LoaderAsync(install, Loader);

        Assert.False(result.Ok);
        Assert.Equal(InstallVerify.LoaderReason, result.Reason);
    }
}
