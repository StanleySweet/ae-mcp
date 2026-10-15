namespace AeMcpSetup.Core;

public sealed record ChecklistItem(string Id, string Label);

public sealed record ChecklistRow(string Id, string Label, string Status, string? Fix = null);

/// <summary>Builds the six checklist rows shown in the Setup window.</summary>
public static class Checklist
{
    public const string Ok = "ok";
    public const string Fail = "fail";
    public const string Pending = "pending";

    /// <summary>The six rows the Setup window shows, in order.</summary>
    public static readonly IReadOnlyList<ChecklistItem> Items =
    [
        new("after_effects", "After Effects found"),
        new("claude", "Claude Desktop found"),
        new("bridge_payload", "Bridge installed"),
        new("scripting_pref", "Scripting permission"),
        new("claude_extension", "Claude extension"),
        new("live_test", "Test"),
    ];

    /// <summary>
    /// Builds the checklist rows from the detected environment plus any
    /// install/repair results. Rows with no result yet are <c>pending</c>.
    /// </summary>
    public static IReadOnlyList<ChecklistRow> Build(
        DetectedEnvironment environment,
        IReadOnlyList<InstallerCheck>? checks = null)
    {
        checks ??= [];
        var rows = new List<ChecklistRow>();
        foreach (var (id, label) in Items)
        {
            var state = EnvironmentState(id, environment) ?? CheckState(checks, id) ?? (Pending, null);
            rows.Add(new ChecklistRow(id, label, state.Status, state.Fix));
        }

        return rows;
    }

    private static (string Status, string? Fix)? EnvironmentState(string id, DetectedEnvironment environment) => id switch
    {
        "after_effects" => environment.AfterEffects.Count > 0
            ? (Ok, null)
            : (Fail, "Install After Effects, then reopen Setup."),
        "claude" => environment.ClaudeDesktop is null
            ? (Fail, "Install Claude Desktop, then reopen Setup.")
            : (Ok, null),
        _ => null,
    };

    private static (string Status, string? Fix)? CheckState(IReadOnlyList<InstallerCheck> checks, string id)
    {
        // The "Bridge installed" row reflects both the payload and the privileged
        // loader step, so a loader failure shows here rather than hiding behind a
        // green row while result.Ok is false.
        var ids = id == "bridge_payload" ? new[] { "bridge_payload", "bridge_loader" } : [id];
        var related = checks.Where(entry => ids.Contains(entry.Check)).ToList();
        if (related.Count == 0)
        {
            return null;
        }

        var failed = related.FirstOrDefault(entry => !entry.IsOk);
        return failed is null ? (Ok, null) : (Fail, failed.Fix);
    }
}
