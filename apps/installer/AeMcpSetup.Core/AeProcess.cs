namespace AeMcpSetup.Core;

/// <summary>Probes whether a named application is running. Injectable for tests.</summary>
public delegate Task<bool> IsRunning(string appName);

/// <summary>
/// Whether an After Effects process is running, via macOS <c>pgrep -f</c>. AE
/// rewrites its prefs on quit, so the scripting preference must be set while it
/// is closed. <c>pgrep</c> exits non-zero when nothing matches, so a miss becomes
/// <c>false</c>.
/// </summary>
public static class AeProcess
{
    public static Task<bool> IsAfterEffectsRunningAsync(string appName = "Adobe After Effects")
        => Shell.SucceedsAsync("pgrep", ["-f", appName]);
}
