using System.Text.Json.Nodes;
using AeMcpSetup.Core;

namespace AeMcpSetup.Core.Tests;

public class HeadlessCheckTests
{
    private static readonly ChecklistRow OkRow = new("after_effects", "After Effects found", "ok");
    private static readonly ChecklistRow FailRow = new(
        "scripting_pref", "Scripting permission", "fail", "Quit After Effects (Cmd+Q), then click Retry.");
    private static readonly ChecklistRow SkipRow = new(
        "live_test", "Test", HeadlessCheck.Skip, HeadlessCheck.SkippedFix);

    private static readonly IReadOnlyList<ChecklistRow> Stubbed = [OkRow, FailRow, SkipRow];

    [Fact]
    public void FormatText_PrintsOneLinePerRowWithStatusIdAndFix()
    {
        var lines = HeadlessCheck.FormatText(Stubbed).Split('\n', StringSplitOptions.RemoveEmptyEntries);

        Assert.Equal(3, lines.Length);
        Assert.StartsWith("ok", lines[0]);
        Assert.Contains("after_effects", lines[0]);
        Assert.DoesNotContain("fix:", lines[0]);
        Assert.StartsWith("fail", lines[1]);
        Assert.Contains("scripting_pref", lines[1]);
        Assert.Contains("fix: Quit After Effects (Cmd+Q), then click Retry.", lines[1]);
    }

    [Fact]
    public void FormatJson_ReturnsTheSameRowsAsAnArray()
    {
        var array = JsonNode.Parse(HeadlessCheck.FormatJson(Stubbed))!.AsArray();

        Assert.Equal(3, array.Count);
        Assert.Equal("after_effects", array[0]!["id"]!.GetValue<string>());
        Assert.Equal("ok", array[0]!["status"]!.GetValue<string>());
        Assert.Null(array[0]!["fix"]);
        Assert.Equal("fail", array[1]!["status"]!.GetValue<string>());
        Assert.Equal("Quit After Effects (Cmd+Q), then click Retry.", array[1]!["fix"]!.GetValue<string>());
        Assert.Equal("Scripting permission", array[1]!["label"]!.GetValue<string>());
    }

    [Fact]
    public void ExitCode_IsZeroWhenEveryCheckedRowIsOkAndIgnoresSkippedRows()
    {
        Assert.Equal(0, HeadlessCheck.ExitCode([OkRow, SkipRow]));
    }

    [Fact]
    public void ExitCode_IsOneWhenAnyCheckedRowFails()
    {
        Assert.Equal(1, HeadlessCheck.ExitCode(Stubbed));
    }

    [Fact]
    public void ExitCode_IsOneWhenARowIsPending()
    {
        var pending = new ChecklistRow("claude", "Claude Desktop found", Checklist.Pending);

        Assert.Equal(1, HeadlessCheck.ExitCode([OkRow, pending]));
    }

    [Fact]
    public async Task RunAsync_WritesTheTextRowsAndReturnsOneWhenTheScriptingPrefIsUnset()
    {
        var root = TempDir.Create();
        var prefsRoot = Path.Combine(root, "prefs");
        var prefsDir = Path.Combine(prefsRoot, "26.5");
        Directory.CreateDirectory(prefsDir);
        var prefsFile = Path.Combine(prefsDir, "Adobe After Effects 26.5 Prefs.txt");
        const string before = "[Main Pref Section v2]\n\"Other\" = \"0\"\n";
        await File.WriteAllTextAsync(prefsFile, before);

        var output = new StringWriter();
        var exit = await HeadlessCheck.RunAsync(new DetectedEnvironment([], null), root, "payload", "loader", false, output, prefsRoot);

        Assert.Equal(1, exit);
        Assert.Contains("fail  scripting_pref", output.ToString());
        Assert.Contains("after_effects", output.ToString());
        // Read-only: the prefs file is untouched and no bridge folder was created.
        Assert.Equal(before, await File.ReadAllTextAsync(prefsFile));
        Assert.False(Directory.Exists(Path.Combine(root, "bridge")));
    }

    [Fact]
    public async Task RunAsync_ReportsScriptingPrefOkWhenTheFileAlreadySetsIt()
    {
        var root = TempDir.Create();
        var prefsRoot = Path.Combine(root, "prefs");
        var prefsDir = Path.Combine(prefsRoot, "26.5");
        Directory.CreateDirectory(prefsDir);
        await File.WriteAllTextAsync(
            Path.Combine(prefsDir, "Adobe After Effects 26.5 Prefs.txt"),
            "[Main Pref Section v2]\n\"Pref_SCRIPTING_FILE_NETWORK_SECURITY\" = \"1\"\n");

        var rows = await HeadlessCheck.GatherAsync(new DetectedEnvironment([], null), root, "payload", "loader", prefsRoot);

        Assert.Equal("ok", rows.First(row => row.Id == "scripting_pref").Status);
        Assert.Equal(HeadlessCheck.Skip, rows.First(row => row.Id == "live_test").Status);
        Assert.Equal(HeadlessCheck.Skip, rows.First(row => row.Id == "claude_extension").Status);
    }

    [Fact]
    public async Task GatherAsync_MarksAnInstalledBridgeOkOnlyWhenPayloadAndLoaderMatch()
    {
        var root = TempDir.Create();
        var appDir = Path.Combine(root, "Applications", "Adobe After Effects 2026");
        var install = new AeInstall("Adobe After Effects 2026", 2026, Path.Combine(appDir, "Adobe After Effects 2026.app"));
        var startup = Path.Combine(appDir, "Scripts", "Startup");
        Directory.CreateDirectory(Path.Combine(root, "bridge"));
        Directory.CreateDirectory(startup);
        await File.WriteAllTextAsync(Path.Combine(root, "bridge", "current.jsx"), "payload");
        await File.WriteAllTextAsync(Path.Combine(startup, InstallLoader.LoaderFileName), "stale loader");

        var rows = await HeadlessCheck.GatherAsync(
            new DetectedEnvironment([install], null), root, "payload", "loader", Path.Combine(root, "prefs"));

        var bridge = rows.First(row => row.Id == "bridge_payload");
        Assert.Equal("fail", bridge.Status);
        Assert.Equal(InstallVerify.LoaderReason, bridge.Fix);
    }
}
