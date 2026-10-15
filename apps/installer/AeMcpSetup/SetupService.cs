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
        var result = await RepairUninstall.RepairAsync(_root, resolved, payload, loader);
        var scriptingPref = await ScriptingPref.EnsureScriptingPrefAsync(resolved.AppName);
        var extension = await InstallMcpb.HandToClaudeAsync(McpbPath, environment.ClaudeDesktop);

        var checks = new List<InstallerCheck>(result.Checks) { scriptingPref, extension };
        // Only smoke-test the bridge when every install step above passed.
        if (checks.All(check => check.IsOk))
        {
            var bridge = new BridgeCall(_root, resolved.AppName);
            LiveCall call = (tool, args) => bridge.CallAsync(tool, args);
            checks.Add(await LiveTest.RunAsync(_root, resolved.AppName, call));
        }

        return new RepairResult(checks.All(check => check.IsOk), checks);
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
