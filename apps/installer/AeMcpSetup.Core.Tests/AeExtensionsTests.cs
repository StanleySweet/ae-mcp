using AeMcpSetup.Core;

namespace AeMcpSetup.Core.Tests;

public class AeExtensionsTests
{
    [Fact]
    public void ListsUserAndSystemExtensionFoldersSortedByName()
    {
        var home = TempDir.Create("ae-mcp-home-");
        var userDir = Path.Combine(home, "Library/Application Support/Adobe/CEP/extensions");
        Directory.CreateDirectory(Path.Combine(userDir, "com.misterhorse.animationcomposer"));
        var systemDir = TempDir.Create("ae-mcp-sys-");
        Directory.CreateDirectory(Path.Combine(systemDir, "com.mtmograph.motion"));

        var found = AeExtensions.DiscoverAeExtensions(home, systemDir);

        Assert.Equal(2, found.Count);
        Assert.Equal("com.misterhorse.animationcomposer", found[0].Name);
        Assert.Equal(Path.Combine(userDir, "com.misterhorse.animationcomposer"), found[0].Path);
        Assert.Equal("user", found[0].Scope);
        Assert.Equal("com.mtmograph.motion", found[1].Name);
        Assert.Equal(Path.Combine(systemDir, "com.mtmograph.motion"), found[1].Path);
        Assert.Equal("system", found[1].Scope);
    }

    [Fact]
    public void IgnoresFilesAndReturnsEmptyWhenTheFoldersAreMissing()
    {
        var home = TempDir.Create("ae-mcp-home-");
        var userDir = Path.Combine(home, "Library/Application Support/Adobe/CEP/extensions");
        Directory.CreateDirectory(userDir);
        Directory.CreateDirectory(Path.Combine(userDir, "not-a-dir"));

        var found = AeExtensions.DiscoverAeExtensions(home, Path.Combine(home, "missing"));

        Assert.Equal(["not-a-dir"], found.Select(e => e.Name));
    }
}
