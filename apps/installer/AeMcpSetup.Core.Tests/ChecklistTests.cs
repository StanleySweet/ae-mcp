using AeMcpSetup.Core;

namespace AeMcpSetup.Core.Tests;

public class ChecklistTests
{
    private static readonly DetectedEnvironment Everything = new(
        [new AeInstall("Adobe After Effects 2026", 2026, "/Applications/AE 2026.app")],
        new ClaudeDesktopInstall(
            "Claude",
            "/Applications/Claude.app",
            "/Users/x/Library/Application Support/Claude",
            "/Users/x/Library/Application Support/Claude/claude_desktop_config.json"));

    [Fact]
    public void ListsTheSixCanonicalRowsInOrder()
    {
        Assert.Equal(
            ["after_effects", "claude", "bridge_payload", "scripting_pref", "claude_extension", "live_test"],
            Checklist.Build(Everything).Select(row => row.Id));
    }

    [Fact]
    public void MarksMissingAeAndClaudeAsFailuresWithAFix()
    {
        var rows = Checklist.Build(new DetectedEnvironment([], null));

        Assert.Equal("fail", rows[0].Status);
        Assert.False(string.IsNullOrEmpty(rows[0].Fix));
        Assert.Equal("fail", rows[1].Status);
        Assert.False(string.IsNullOrEmpty(rows[1].Fix));
    }

    [Fact]
    public void MarksFoundAeAndClaudeAsOkAndLeavesTheRestPending()
    {
        var rows = Checklist.Build(Everything);

        Assert.Equal("ok", rows[0].Status);
        Assert.Equal("ok", rows[1].Status);
        Assert.True(rows.Skip(2).All(row => row.Status == Checklist.Pending));
    }

    [Fact]
    public void MergesInstallCheckResultsIntoTheRows()
    {
        var checks = new List<InstallerCheck>
        {
            new("bridge_payload", "ok"),
            new("live_test", "fail", "Reopen After Effects."),
        };

        var rows = Checklist.Build(Everything, checks);

        Assert.Equal("ok", rows.First(row => row.Id == "bridge_payload").Status);
        var live = rows.First(row => row.Id == "live_test");
        Assert.Equal("fail", live.Status);
        Assert.Equal("Reopen After Effects.", live.Fix);
        Assert.Equal("pending", rows.First(row => row.Id == "scripting_pref").Status);
    }

    [Fact]
    public void SurfacesALoaderFailureInTheBridgeInstalledRow()
    {
        var checks = new List<InstallerCheck>
        {
            new("bridge_payload", "ok"),
            new("bridge_loader", "fail", "Grant admin to install the loader."),
        };

        var rows = Checklist.Build(Everything, checks);

        // The loader is part of "Bridge installed", so its failure must show there
        // instead of setting result.Ok=false behind an all-green checklist.
        var bridge = rows.First(row => row.Id == "bridge_payload");
        Assert.Equal("fail", bridge.Status);
        Assert.Equal("Grant admin to install the loader.", bridge.Fix);
    }

    [Fact]
    public void ExposesStableLabels()    {
        foreach (var item in Checklist.Build(Everything))
        {
            Assert.False(string.IsNullOrEmpty(item.Label));
        }
    }
}
