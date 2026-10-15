using AeMcpSetup.Core;

namespace AeMcpSetup.Core.Tests;

public class LiveTestTests
{
    private static string TempRoot() => TempDir.Create("ae-mcp-live-");

    private static void WriteHeartbeat(string root)
    {
        var dir = Path.Combine(root, "bridge", "outbox");
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "heartbeat.json"), "{}");
    }

    private static long NowMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    [Fact]
    public async Task IsHeartbeatFreshTrueForAHeartbeatWrittenJustNow()
    {
        var root = TempRoot();
        WriteHeartbeat(root);
        Assert.True(await LiveTest.IsHeartbeatFreshAsync(root, 90_000, NowMs));
    }

    [Fact]
    public async Task IsHeartbeatFreshFalseWhenTheHeartbeatIsMissing()
    {
        Assert.False(await LiveTest.IsHeartbeatFreshAsync(TempRoot(), 90_000, NowMs));
    }

    [Fact]
    public async Task IsHeartbeatFreshFalseWhenTheHeartbeatIsOlderThanTheWindow()
    {
        var root = TempRoot();
        WriteHeartbeat(root);
        Assert.False(await LiveTest.IsHeartbeatFreshAsync(root, 90_000, () => NowMs() + 10_000_000));
    }

    [Fact]
    public async Task PassesWhenAeIsUpAndTheTestCompCanBeCreatedThenRemoved()
    {
        var root = TempRoot();
        WriteHeartbeat(root);
        var launched = false;
        var tools = new List<string>();

        var result = await LiveTest.RunAsync(
            root,
            "Adobe After Effects 2026",
            (tool, _) => { tools.Add(tool); return Task.FromResult(true); },
            launch: _ => { launched = true; return Task.FromResult(true); });

        Assert.Equal("live_test", result.Check);
        Assert.Equal("ok", result.Status);
        Assert.False(launched);
        Assert.Equal(["comp.create", "project.undo"], tools);
    }

    [Fact]
    public async Task LaunchesAeWhenNoHeartbeatIsPresent()
    {
        var root = TempRoot();
        string? launchedName = null;

        var result = await LiveTest.RunAsync(
            root,
            "Adobe After Effects 2026",
            (_, _) => Task.FromResult(true),
            launch: name => { launchedName = name; WriteHeartbeat(root); return Task.FromResult(true); });

        Assert.Equal("ok", result.Status);
        Assert.Equal("Adobe After Effects 2026", launchedName);
    }

    [Fact]
    public async Task FailsWithAFixWhenAeCannotBeLaunched()
    {
        var root = TempRoot();
        var called = false;

        var result = await LiveTest.RunAsync(
            root,
            "Adobe After Effects 2026",
            (_, _) => { called = true; return Task.FromResult(true); },
            launch: _ => Task.FromResult(false));

        Assert.Equal("fail", result.Status);
        Assert.False(string.IsNullOrEmpty(result.Fix));
        Assert.False(called);
    }

    [Fact]
    public async Task FailsWhenTheHeartbeatNeverArrives()
    {
        var root = TempRoot();
        var called = false;

        var result = await LiveTest.RunAsync(
            root,
            "Adobe After Effects 2026",
            (_, _) => { called = true; return Task.FromResult(true); },
            launch: _ => Task.FromResult(true),
            timeoutMs: 0);

        Assert.Equal("fail", result.Status);
        Assert.False(string.IsNullOrEmpty(result.Fix));
        Assert.False(called);
    }

    [Fact]
    public async Task FailsWhenTheTestCompCannotBeCreated()
    {
        var root = TempRoot();
        WriteHeartbeat(root);

        var result = await LiveTest.RunAsync(
            root,
            "Adobe After Effects 2026",
            (_, _) => Task.FromResult(false));

        Assert.Equal("fail", result.Status);
        Assert.False(string.IsNullOrEmpty(result.Fix));
    }

    [Fact]
    public async Task FailsWhenTheTestCompCannotBeRemoved()
    {
        var root = TempRoot();
        WriteHeartbeat(root);

        var result = await LiveTest.RunAsync(
            root,
            "Adobe After Effects 2026",
            (tool, _) => Task.FromResult(tool == "comp.create"));

        Assert.Equal("fail", result.Status);
        Assert.False(string.IsNullOrEmpty(result.Fix));
    }
}
