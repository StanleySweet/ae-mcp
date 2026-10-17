using AeMcpSetup.Core;

namespace AeMcpSetup;

/// <summary>
/// The typed glue between the window and <c>AeMcpSetup.Core</c>: detect, install,
/// uninstall, export diagnostics. Every method is idempotent.
/// </summary>
public sealed class SetupService
{
    public const string AeMcpRootName = ".ae-mcp";

    private readonly string _root;
    private readonly string _baseDir;
    private readonly string _applicationsDir;

    public SetupService(string? root = null, string? baseDir = null, string? applicationsDir = null)
    {
        _root = root ?? Path.Combine(Home(), AeMcpRootName);
        _baseDir = baseDir ?? AppContext.BaseDirectory;
        _applicationsDir = applicationsDir ?? "/Applications";
    }

    public string PayloadPath => Path.Combine(_baseDir, "payload.jsx");

    public string LoaderPath => Path.Combine(_baseDir, "loader.jsx");

    public string McpbPath => Path.Combine(_baseDir, "ae-mcp.mcpb");

    public Task<DetectedEnvironment> DetectAsync()
        => EnvironmentDetector.DetectEnvironmentAsync(_applicationsDir);

    /// <summary>Runs every install/repair step for the given (or newest detected) AE.</summary>
    public async Task<RepairResult> RepairAsync(AeInstall? install = null)
    {
        var environment = await DetectAsync();
        var resolved = install ?? environment.AfterEffects.FirstOrDefault();
        if (resolved is null)
        {
            return new RepairResult(false,
                [new InstallerCheck("after_effects", "fail", "Install After Effects, then reopen Setup.")]);
        }

        var payload = await ReadResourceAsync(PayloadPath);
        var loader = await ReadResourceAsync(LoaderPath);

        // The core install is all-or-nothing: the privileged loader runs first, and
        // a failure means nothing else is written (no half install).
        var core = await RepairUninstall.RepairAsync(_root, resolved, payload, loader);
        if (!core.Ok)
        {
            return new RepairResult(false, core.Checks);
        }

        // A step can report success yet leave a missing or stale file, so re-read
        // both targets and compare them with the bundled content before going on.
        var verified = new[]
        {
            await InstallVerify.PayloadAsync(_root, payload),
            await InstallVerify.LoaderAsync(resolved, loader),
        };
        var mismatches = verified.Where(result => !result.Ok).ToList();
        if (mismatches.Count > 0)
        {
            var failed = new List<InstallerCheck>(core.Checks);
            failed.AddRange(mismatches.Select(result =>
                new InstallerCheck(result.Id, InstallerCheck.FailStatus, result.Reason)));
            return new RepairResult(false, failed);
        }

        var scriptingPref = await ScriptingPref.EnsureScriptingPrefAsync(resolved.AppName);
        var extension = await InstallMcpb.HandToClaudeAsync(McpbPath, environment.ClaudeDesktop);
        var checks = new List<InstallerCheck>(core.Checks) { scriptingPref, extension };

        // The bridge is installed, so prove it works even if the pref or extension
        // step reported a problem. The test needs a fresh heartbeat (the loader).
        var bridge = new BridgeCall(_root, resolved.AppName);
        LiveCall call = (tool, args) => bridge.CallAsync(tool, args);
        checks.Add(await LiveTest.RunAsync(_root, resolved.AppName, call));

        return new RepairResult(checks.All(check => check.IsOk), checks);
    }

    /// <summary>Reads what is already installed for <paramref name="install"/>, compared with the bundled payload.</summary>
    public async Task<InstallState> DetectInstallAsync(AeInstall install)
    {
        var payload = await ReadResourceAsync(PayloadPath);
        return await InstallDetector.DetectAsync(_root, install, payload);
    }

    /// <summary>Removes the bridge payload, folders and Startup loader.</summary>
    public async Task<UninstallResult> UninstallAsync(AeInstall? install = null)
    {
        var environment = await DetectAsync();
        var resolved = install ?? environment.AfterEffects.FirstOrDefault();
        if (resolved is null)
        {
            return new UninstallResult(
                "uninstall", "fail", [],
                "After Effects is not installed; nothing to remove.");
        }

        return await RepairUninstall.UninstallAsync(_root, resolved);
    }

    /// <summary>Runs the read-only checklist for <c>--check</c>: no writes, no admin prompt, no AE launch.</summary>
    public async Task<int> RunCheckAsync(bool json, TextWriter output)
    {
        var environment = await DetectAsync();
        return await HeadlessCheck.RunAsync(
            environment,
            _root,
            await ReadResourceAsync(PayloadPath),
            await ReadResourceAsync(LoaderPath),
            json,
            output);
    }

    /// <summary>Writes a diagnostics report to the Desktop and returns its path.</summary>
    public async Task<string> DiagnosticsAsync()
    {
        var environment = await DetectAsync();
        var target = Path.Combine(Home(), "Desktop", "ae-mcp-diagnostics.txt");
        Directory.CreateDirectory(Path.GetDirectoryName(target)!);
        await File.WriteAllTextAsync(target, Diagnostics.Format(environment));
        return target;
    }

    private static async Task<string> ReadResourceAsync(string path)
        => File.Exists(path) ? await File.ReadAllTextAsync(path) : "";

    private static string Home() => Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
}
