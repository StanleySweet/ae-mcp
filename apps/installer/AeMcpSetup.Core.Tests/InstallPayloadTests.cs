using AeMcpSetup.Core;

namespace AeMcpSetup.Core.Tests;

public class InstallPayloadTests
{
    [Fact]
    public async Task CreatesTheQueueRootOwnerOnly()
    {
        var root = TempDir.Create("ae-mcp-root-");

        await InstallPayload.InstallAsync(root, "var AEMCP_BRIDGE_VERSION = \"1.0.0\";");

        Assert.Equal(0, (int)File.GetUnixFileMode(root) & 0b111_111);
    }

    [Fact]
    public async Task RepairsTheQueueRootPermissions()
    {
        var root = TempDir.Create("ae-mcp-root-");
        File.SetUnixFileMode(root, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute
            | UnixFileMode.GroupRead | UnixFileMode.GroupExecute | UnixFileMode.OtherRead | UnixFileMode.OtherExecute);

        await InstallPayload.InstallAsync(root, "var AEMCP_BRIDGE_VERSION = \"1.0.0\";");

        Assert.Equal(0, (int)File.GetUnixFileMode(root) & 0b111_111);
    }

    [Fact]
    public void PayloadVersionReadsTheVersionFromTheBuildStamp()
    {
        Assert.Equal("1.2.3", InstallPayload.PayloadVersion("var AEMCP_BRIDGE_VERSION = \"1.2.3\";"));
    }

    [Fact]
    public void PayloadVersionReturnsNullWhenTheStampIsMissing()
    {
        Assert.Null(InstallPayload.PayloadVersion("var x = 1;"));
    }

    [Fact]
    public async Task WritesThePayloadAndCreatesTheBridgeFolders()
    {
        var root = TempDir.Create("ae-mcp-root-");
        const string payload = "var AEMCP_BRIDGE_VERSION = \"1.2.3\";\n";

        var result = await InstallPayload.InstallAsync(root, payload);

        Assert.Equal("bridge_payload", result.Check);
        Assert.Equal("ok", result.Status);
        Assert.Equal("1.2.3", result.Version);
        Assert.True(result.Changed);
        Assert.Equal(payload, await File.ReadAllTextAsync(Path.Combine(root, "bridge", "current.jsx")));
        var entries = Directory.GetFileSystemEntries(Path.Combine(root, "bridge")).Select(Path.GetFileName).ToArray();
        Assert.Contains("inbox", entries);
        Assert.Contains("outbox", entries);
    }

    [Fact]
    public async Task IsIdempotentWhenThePayloadIsUnchanged()
    {
        var root = TempDir.Create("ae-mcp-home-");
        const string payload = "var AEMCP_BRIDGE_VERSION = \"1.0.0\";";

        await InstallPayload.InstallAsync(root, payload);
        var second = await InstallPayload.InstallAsync(root, payload);

        Assert.Equal("ok", second.Status);
        Assert.Equal("1.0.0", second.Version);
        Assert.False(second.Changed);
    }

    [Fact]
    public async Task RewritesWhenThePayloadVersionChanges()
    {
        var root = TempDir.Create("ae-mcp-home-");

        await InstallPayload.InstallAsync(root, "var AEMCP_BRIDGE_VERSION = \"1.0.0\";");
        var second = await InstallPayload.InstallAsync(root, "var AEMCP_BRIDGE_VERSION = \"2.0.0\";");

        Assert.Equal("ok", second.Status);
        Assert.Equal("2.0.0", second.Version);
        Assert.True(second.Changed);
        Assert.Contains("2.0.0", await File.ReadAllTextAsync(Path.Combine(root, "bridge", "current.jsx")));
    }

    [Fact]
    public async Task FailsWithAFixWhenThePayloadCarriesNoVersionStamp()
    {
        var root = TempDir.Create("ae-mcp-home-");

        var result = await InstallPayload.InstallAsync(root, "// no stamp here");

        Assert.Equal("fail", result.Status);
        Assert.False(string.IsNullOrEmpty(result.Fix));
    }

    [Fact]
    public async Task FailsWithAFixWhenTheTargetCannotBeCreated()
    {
        var parent = TempDir.Create("ae-mcp-home-");
        var root = Path.Combine(parent, "not-a-dir");
        await File.WriteAllTextAsync(root, "file in the way");

        var result = await InstallPayload.InstallAsync(root, "var AEMCP_BRIDGE_VERSION = \"1.0.0\";");

        Assert.Equal("fail", result.Status);
        Assert.False(string.IsNullOrEmpty(result.Fix));
    }

    [Fact]
    public async Task ReplacesAPreviouslyInstalledPayload()
    {
        var root = TempDir.Create("ae-mcp-home-");
        Directory.CreateDirectory(Path.Combine(root, "bridge"));
        await File.WriteAllTextAsync(Path.Combine(root, "bridge", "current.jsx"), "var AEMCP_BRIDGE_VERSION = \"0.0.1\";");

        var result = await InstallPayload.InstallAsync(root, "var AEMCP_BRIDGE_VERSION = \"2.0.0\";");

        Assert.True(result.Changed);
        Assert.Contains("2.0.0", await File.ReadAllTextAsync(Path.Combine(root, "bridge", "current.jsx")));
    }
}
