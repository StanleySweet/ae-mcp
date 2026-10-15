using AeMcpSetup.Core;

namespace AeMcpSetup.Core.Tests;

public class InstallLoaderTests
{
    private const string Loader = "var AEMCP_LOADER = true;";

    private static (AeInstall Install, string Folder) FakeInstall(bool withScripts = false)
    {
        var folder = TempDir.Create("ae-mcp-ae-");
        const string appName = "Adobe After Effects 2026";
        var appPath = Path.Combine(folder, $"{appName}.app");
        Directory.CreateDirectory(appPath);
        if (withScripts)
        {
            Directory.CreateDirectory(Path.Combine(folder, "Scripts"));
        }

        return (new AeInstall(appName, 2026, appPath), folder);
    }

    [Fact]
    public void LoaderStartupDirIsTheScriptsStartupFolderNextToTheAppBundle()
    {
        var (install, folder) = FakeInstall();
        Assert.Equal(Path.Combine(folder, "Scripts", "Startup"), InstallLoader.LoaderStartupDir(install));
    }

    [Fact]
    public void ElevatedCopyCommandQuotesAndCreatesTheFolder()
    {
        Assert.Equal(
            "mkdir -p '/Applications/It'\\''s/Scripts/Startup' && cp '/tmp/a file.jsx' '/Applications/It'\\''s/Scripts/Startup/l.jsx'",
            InstallLoader.ElevatedCopyCommand("/tmp/a file.jsx", "/Applications/It's/Scripts/Startup/l.jsx"));
    }

    [Fact]
    public async Task WritesTheLoaderIntoScriptsStartup()
    {
        var (install, folder) = FakeInstall();

        var result = await InstallLoader.InstallAsync(install, Loader);

        Assert.Equal("bridge_loader", result.Check);
        Assert.Equal("ok", result.Status);
        Assert.True(result.Changed);
        Assert.Equal(Path.Combine(folder, "Scripts", "Startup", "ae-mcp-loader.jsx"), result.Path);
        Assert.Equal(Loader, await File.ReadAllTextAsync(Path.Combine(folder, "Scripts", "Startup", "ae-mcp-loader.jsx")));
    }

    [Fact]
    public async Task IsIdempotentOnASecondRun()
    {
        var (install, _) = FakeInstall();

        await InstallLoader.InstallAsync(install, Loader);
        var second = await InstallLoader.InstallAsync(install, Loader);

        Assert.Equal("ok", second.Status);
        Assert.False(second.Changed);
    }

    [Fact]
    public async Task RewritesWhenTheLoaderChanges()
    {
        var (install, folder) = FakeInstall();

        await InstallLoader.InstallAsync(install, Loader);
        var second = await InstallLoader.InstallAsync(install, $"{Loader}\n// v2");

        Assert.True(second.Changed);
        Assert.Contains("// v2", await File.ReadAllTextAsync(Path.Combine(folder, "Scripts", "Startup", "ae-mcp-loader.jsx")));
    }

    [Fact]
    public async Task TakesAnOverrideFileName()
    {
        var (install, folder) = FakeInstall();

        await InstallLoader.InstallAsync(install, Loader, "custom.jsx");

        Assert.Equal(Loader, await File.ReadAllTextAsync(Path.Combine(folder, "Scripts", "Startup", "custom.jsx")));
    }

    [Fact]
    public async Task FallsBackToManualTextWhenTheFolderCannotBeCreated()
    {
        var (install, folder) = FakeInstall();
        await File.WriteAllTextAsync(Path.Combine(folder, "Scripts"), "a file blocks the folder");
        var elevateCalled = false;

        var result = await InstallLoader.InstallAsync(install, Loader, elevatedWrite: (_, _) =>
        {
            elevateCalled = true;
            return Task.FromResult(true);
        });

        Assert.Equal("fail", result.Status);
        Assert.False(string.IsNullOrEmpty(result.Fix));
        Assert.False(string.IsNullOrEmpty(result.Manual));
        Assert.False(elevateCalled);
    }

    [Fact]
    public async Task UsesAdminElevationWhenTheFolderIsNotWritable()
    {
        var (install, folder) = FakeInstall(withScripts: true);
        var scriptsDir = Path.Combine(folder, "Scripts");
        File.SetUnixFileMode(scriptsDir, UnixFileMode.UserRead | UnixFileMode.UserExecute);
        try
        {
            string? elevatedPath = null;
            var result = await InstallLoader.InstallAsync(install, Loader, elevatedWrite: (path, _) =>
            {
                elevatedPath = path;
                return Task.FromResult(true);
            });

            Assert.Equal("ok", result.Status);
            Assert.True(result.Changed);
            Assert.Equal(Path.Combine(scriptsDir, "Startup", "ae-mcp-loader.jsx"), elevatedPath);
        }
        finally
        {
            File.SetUnixFileMode(scriptsDir, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        }
    }

    [Fact]
    public async Task ReportsFailureWithManualTextWhenElevationIsDeclined()
    {
        var (install, folder) = FakeInstall(withScripts: true);
        var scriptsDir = Path.Combine(folder, "Scripts");
        File.SetUnixFileMode(scriptsDir, UnixFileMode.UserRead | UnixFileMode.UserExecute);
        try
        {
            var result = await InstallLoader.InstallAsync(install, Loader, elevatedWrite: (_, _) => Task.FromResult(false));

            Assert.Equal("fail", result.Status);
            Assert.False(string.IsNullOrEmpty(result.Fix));
            Assert.False(string.IsNullOrEmpty(result.Manual));
        }
        finally
        {
            File.SetUnixFileMode(scriptsDir, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        }
    }
}
