namespace AeMcpSetup.Core;

/// <summary>
/// The outcome of re-reading one installed target. <c>Id</c> is the checklist
/// check name the result belongs to.
/// </summary>
public sealed record VerifyResult(string Id, bool Ok, string? Reason = null);

/// <summary>
/// Re-reads what the install steps wrote and compares it with the bundled content,
/// so a step that reported success but left a missing or stale file is caught.
/// </summary>
public static class InstallVerify
{
    public const string PayloadReason = "The bridge payload was not written; run Install again.";

    public const string LoaderReason =
        "The loader was not written; run Install again and approve the admin prompt.";

    private const string PayloadCheck = "bridge_payload";
    private const string LoaderCheck = "bridge_loader";

    /// <summary>Checks that <c>&lt;root&gt;/bridge/current.jsx</c> holds exactly <paramref name="payload"/>.</summary>
    public static async Task<VerifyResult> PayloadAsync(string root, string payload)
    {
        var installed = await Io.ReadFileOrNullAsync(Path.Combine(root, "bridge", "current.jsx"));
        return installed == payload
            ? new VerifyResult(PayloadCheck, true)
            : new VerifyResult(PayloadCheck, false, PayloadReason);
    }

    /// <summary>Checks that the startup loader in AE's Startup folder holds exactly <paramref name="loader"/>.</summary>
    public static async Task<VerifyResult> LoaderAsync(
        AeInstall install,
        string loader,
        string? fileName = null)
    {
        var path = Path.Combine(InstallLoader.LoaderStartupDir(install), fileName ?? InstallLoader.LoaderFileName);
        var installed = await Io.ReadFileOrNullAsync(path);
        return installed == loader
            ? new VerifyResult(LoaderCheck, true)
            : new VerifyResult(LoaderCheck, false, LoaderReason);
    }
}
