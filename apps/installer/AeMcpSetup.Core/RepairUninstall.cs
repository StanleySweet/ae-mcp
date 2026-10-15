namespace AeMcpSetup.Core;

public sealed record RepairResult(bool Ok, IReadOnlyList<InstallerCheck> Checks);

public sealed record UninstallResult(
    string Check,
    string Status,
    IReadOnlyList<string> Removed,
    string? Fix = null,
    bool? NeedsQuit = null) : InstallerCheck(Check, Status, Fix, NeedsQuit);

/// <summary>Repairs or removes an ae-mcp install.</summary>
public static class RepairUninstall
{
    /// <summary>
    /// Repairs an install by re-running the bridge install steps. Every step is
    /// idempotent, so this is also the first-install path.
    /// </summary>
    public static async Task<RepairResult> RepairAsync(
        string root,
        AeInstall install,
        string payload,
        string loader,
        string? fileName = null)
    {
        var payloadCheck = await InstallPayload.InstallAsync(root, payload);
        var loaderCheck = await InstallLoader.InstallAsync(install, loader, fileName);
        var checks = new List<InstallerCheck> { payloadCheck, loaderCheck };
        return new RepairResult(checks.All(check => check.IsOk), checks);
    }

    /// <summary>
    /// Removes the bridge payload/folders and the Startup loader. Leaves settings
    /// and the Claude Desktop extension alone. Idempotent: missing files ignored.
    /// </summary>
    public static Task<UninstallResult> UninstallAsync(string root, AeInstall install, string? fileName = null)
    {
        var targets = new[]
        {
            Path.Combine(InstallLoader.LoaderStartupDir(install), fileName ?? InstallLoader.LoaderFileName),
            Path.Combine(root, "bridge"),
        };

        var removed = new List<string>();
        try
        {
            foreach (var target in targets)
            {
                if (Directory.Exists(target))
                {
                    Directory.Delete(target, recursive: true);
                    removed.Add(target);
                }
                else if (File.Exists(target))
                {
                    File.Delete(target);
                    removed.Add(target);
                }
            }

            return Task.FromResult(new UninstallResult("uninstall", "ok", removed));
        }
        catch
        {
            return Task.FromResult(new UninstallResult(
                "uninstall", "fail", removed,
                "Some files could not be removed; delete them with an administrator and quit After Effects first."));
        }
    }
}
