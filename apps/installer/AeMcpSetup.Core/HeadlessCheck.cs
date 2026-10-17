using System.Text.Json;
using System.Text.Json.Nodes;

namespace AeMcpSetup.Core;

/// <summary>
/// The read-only checklist behind <c>AeMcpSetup --check</c>. It only reads: it never
/// writes files, never shows the admin prompt and never launches After Effects.
/// Rows that need a write or a launch are reported as <c>skip</c> and do not count
/// toward the exit code.
/// </summary>
public static class HeadlessCheck
{
    /// <summary>Status of a row the headless check does not run.</summary>
    public const string Skip = "skip";

    public const string SkippedFix = "Not checked by --check; open Setup to run it.";

    private const string MissingPrefsFix = "Open After Effects once so it writes its preferences, then run Setup again.";
    private const string UnsetPrefFix = "Quit After Effects, then run Setup again to enable the scripting permission.";
    private const string MissingAeFix = "Install After Effects, then reopen Setup.";

    // claude_extension needs Claude Desktop's own state; live_test launches AE. Neither is read-only.
    private static readonly string[] SkippedIds = ["claude_extension", "live_test"];

    /// <summary>Builds every checklist row from read-only probes.</summary>
    public static async Task<IReadOnlyList<ChecklistRow>> GatherAsync(
        DetectedEnvironment environment,
        string root,
        string payload,
        string loader,
        string? prefsRoot = null)
    {
        var checks = new List<InstallerCheck>();
        var install = environment.AfterEffects.FirstOrDefault();

        var payloadResult = await InstallVerify.PayloadAsync(root, payload);
        checks.Add(ToCheck(payloadResult));

        checks.Add(install is null
            ? new InstallerCheck("bridge_loader", InstallerCheck.FailStatus, MissingAeFix)
            : ToCheck(await InstallVerify.LoaderAsync(install, loader)));

        checks.Add(await ScriptingPrefCheckAsync(prefsRoot));

        return Checklist.Build(environment, checks)
            .Select(row => SkippedIds.Contains(row.Id) ? new ChecklistRow(row.Id, row.Label, Skip, SkippedFix) : row)
            .ToList();
    }

    /// <summary>One line per row: status, id, label, then the fix when there is one.</summary>
    public static string FormatText(IReadOnlyList<ChecklistRow> rows)
    {
        var lines = rows.Select(row =>
            $"{row.Status,-5} {row.Id,-17} {row.Label}"
            + (string.IsNullOrEmpty(row.Fix) ? "" : $" | fix: {row.Fix}"));
        return string.Join('\n', lines) + "\n";
    }

    /// <summary>The same rows as a JSON array of <c>{id, label, status, fix}</c> objects.</summary>
    public static string FormatJson(IReadOnlyList<ChecklistRow> rows)
    {
        var array = new JsonArray();
        foreach (var row in rows)
        {
            array.Add(new JsonObject
            {
                ["id"] = row.Id,
                ["label"] = row.Label,
                ["status"] = row.Status,
                ["fix"] = row.Fix is null ? null : JsonValue.Create(row.Fix),
            });
        }

        return array.ToJsonString(new JsonSerializerOptions { WriteIndented = true }) + "\n";
    }

    /// <summary>0 when every checked row is <c>ok</c>, 1 otherwise. Skipped rows are ignored.</summary>
    public static int ExitCode(IReadOnlyList<ChecklistRow> rows)
        => rows.Where(row => row.Status != Skip).All(row => row.Status == Checklist.Ok) ? 0 : 1;

    /// <summary>Gathers the rows, writes them as text or JSON, and returns the exit code.</summary>
    public static async Task<int> RunAsync(
        DetectedEnvironment environment,
        string root,
        string payload,
        string loader,
        bool json,
        TextWriter output,
        string? prefsRoot = null)
    {
        var rows = await GatherAsync(environment, root, payload, loader, prefsRoot);
        output.Write(json ? FormatJson(rows) : FormatText(rows));
        return ExitCode(rows);
    }

    private static InstallerCheck ToCheck(VerifyResult result)
        => result.Ok
            ? new InstallerCheck(result.Id, InstallerCheck.OkStatus)
            : new InstallerCheck(result.Id, InstallerCheck.FailStatus, result.Reason);

    /// <summary>Reads the newest prefs file and reports the scripting pref without touching it.</summary>
    private static async Task<InstallerCheck> ScriptingPrefCheckAsync(string? prefsRoot)
    {
        var dirs = ScriptingPref.DiscoverPrefsDirs(prefsRoot);
        var prefsFile = dirs.Count == 0 ? null : ScriptingPref.FindPrefsFile(dirs[0].Dir);
        var content = prefsFile is null ? null : await Io.ReadFileOrNullAsync(prefsFile);
        if (content is null)
        {
            return new InstallerCheck("scripting_pref", InstallerCheck.FailStatus, MissingPrefsFix);
        }

        return ScriptingPref.ReadScriptingPref(content) == 1
            ? new InstallerCheck("scripting_pref", InstallerCheck.OkStatus)
            : new InstallerCheck("scripting_pref", InstallerCheck.FailStatus, UnsetPrefFix);
    }
}
