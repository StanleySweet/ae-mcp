using AeMcpSetup.Core;

namespace AeMcpSetup.Core.Tests;

public class AeDiscoveryTests
{
    private static string FakeApplications(params string[] names)
    {
        var dir = TempDir.Create("ae-mcp-apps-");
        foreach (var name in names)
        {
            Directory.CreateDirectory(Path.Combine(dir, name));
        }

        return dir;
    }

    [Fact]
    public void ReturnsSupportedVersionsNewestFirstAndIgnoresOlderOnes()
    {
        var dir = FakeApplications(
            "Adobe After Effects 2024",
            "Adobe After Effects 2026.app",
            "Adobe After Effects 2025.app",
            "Adobe Photoshop 2025.app",
            "Safari.app");
        Directory.CreateDirectory(Path.Combine(dir, "Adobe After Effects 2024", "Adobe After Effects 2024.app"));

        var installs = AeDiscovery.DiscoverAeVersions(dir);

        Assert.Equal([2026, 2025], installs.Select(i => i.Year));
        Assert.Equal("Adobe After Effects 2026", installs[0].AppName);
        Assert.Equal(Path.Combine(dir, "Adobe After Effects 2026.app"), installs[0].Path);
    }

    [Fact]
    public void FindsTheNestedVersionedFolderLayout()
    {
        var dir = FakeApplications("Adobe After Effects 2026");
        Directory.CreateDirectory(Path.Combine(dir, "Adobe After Effects 2026", "Adobe After Effects 2026.app"));

        var installs = AeDiscovery.DiscoverAeVersions(dir);

        var only = Assert.Single(installs);
        Assert.Equal("Adobe After Effects 2026", only.AppName);
        Assert.Equal(2026, only.Year);
        Assert.Equal(Path.Combine(dir, "Adobe After Effects 2026", "Adobe After Effects 2026.app"), only.Path);
    }

    [Fact]
    public void IgnoresAVersionedFolderWithNoAppBundleInside()
    {
        var dir = FakeApplications("Adobe After Effects 2025");
        Assert.Empty(AeDiscovery.DiscoverAeVersions(dir));
    }

    [Fact]
    public void ReturnsEmptyWhenTheDirectoryIsMissing()
    {
        Assert.Empty(AeDiscovery.DiscoverAeVersions("/nope/not/here"));
    }

    [Fact]
    public void ReturnsEmptyWhenNothingSupportedIsInstalled()
    {
        var dir = FakeApplications("Adobe After Effects 2024.app");
        Assert.Empty(AeDiscovery.DiscoverAeVersions(dir));
    }
}
