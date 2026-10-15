namespace AeMcpSetup.Core;

/// <summary>Opens AE and reports whether the <c>open</c> call succeeded.</summary>
public delegate Task<bool> LaunchAE(string appName);

/// <summary>Runs one bridge operation and reports whether it succeeded.</summary>
public delegate Task<bool> LiveCall(string tool, IReadOnlyDictionary<string, object?>? args);

/// <summary>Install-time smoke test: create and remove a test comp through the bridge.</summary>
public static class LiveTest
{
    public const string TestCompName = "AE-MCP Test";

    private const long DefaultTimeoutMs = 60_000;
    private const int DefaultPollMs = 500;
    private const long DefaultHeartbeatMaxAgeMs = 90_000;

    /// <summary>Whether the bridge heartbeat file exists and was modified within <paramref name="maxAgeMs"/>.</summary>
    public static Task<bool> IsHeartbeatFreshAsync(string root, long maxAgeMs, Func<long> now)
    {
        try
        {
            var heartbeat = new FileInfo(Path.Combine(root, "bridge", "outbox", "heartbeat.json"));
            if (!heartbeat.Exists)
            {
                return Task.FromResult(false);
            }

            var mtime = new DateTimeOffset(heartbeat.LastWriteTimeUtc).ToUnixTimeMilliseconds();
            return Task.FromResult(now() - mtime <= maxAgeMs);
        }
        catch
        {
            return Task.FromResult(false);
        }
    }

    /// <summary>
    /// Launches After Effects if needed, waits for a fresh heartbeat, then creates
    /// and removes a test comp through the bridge. Returns a <c>live_test</c> row.
    /// </summary>
    public static async Task<InstallerCheck> RunAsync(
        string root,
        string appName,
        LiveCall call,
        LaunchAE? launch = null,
        Func<long>? now = null,
        Func<int, Task>? sleep = null,
        long timeoutMs = DefaultTimeoutMs,
        int pollMs = DefaultPollMs,
        long heartbeatMaxAgeMs = DefaultHeartbeatMaxAgeMs)
    {
        now ??= () => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        sleep ??= ms => Task.Delay(ms);

        if (!await IsHeartbeatFreshAsync(root, heartbeatMaxAgeMs, now))
        {
            var doLaunch = launch ?? (name => Shell.SucceedsAsync("open", ["-a", name]));
            if (!await doLaunch(appName))
            {
                return new InstallerCheck(
                    "live_test", "fail",
                    "After Effects could not be launched; open it manually, then run the test again.");
            }

            var start = now();
            while (!await IsHeartbeatFreshAsync(root, heartbeatMaxAgeMs, now) && now() - start < timeoutMs)
            {
                await sleep(pollMs);
            }

            if (!await IsHeartbeatFreshAsync(root, heartbeatMaxAgeMs, now))
            {
                return new InstallerCheck(
                    "live_test", "fail",
                    "After Effects never reported a heartbeat; reopen it and reinstall the bridge.");
            }
        }

        var createArgs = new Dictionary<string, object?>
        {
            ["name"] = TestCompName,
            ["width"] = 1920,
            ["height"] = 1080,
        };
        if (!await call("comp.create", createArgs))
        {
            return new InstallerCheck(
                "live_test", "fail",
                "After Effects could not create a test comp; check the scripting preference and reinstall.");
        }

        if (!await call("project.undo", new Dictionary<string, object?>()))
        {
            return new InstallerCheck(
                "live_test", "fail",
                "After Effects could not remove the test comp; undo the change by hand.");
        }

        return new InstallerCheck("live_test", "ok");
    }
}
