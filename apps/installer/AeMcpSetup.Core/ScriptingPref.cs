using System.Text.RegularExpressions;

namespace AeMcpSetup.Core;

public sealed record EnableScriptingPrefResult(
    string Check,
    string Status,
    bool Changed,
    int Value,
    string? Fix = null,
    bool? NeedsQuit = null,
    string? Backup = null) : InstallerCheck(Check, Status, Fix, NeedsQuit);

/// <summary>Enables <c>Pref_SCRIPTING_FILE_NETWORK_SECURITY</c> in AE's prefs file.</summary>
public static partial class ScriptingPref
{
    public const string ScriptingPrefKey = "Pref_SCRIPTING_FILE_NETWORK_SECURITY";
    public const string MainPrefSection = "[Main Pref Section v2]";
    private const string BackupSuffix = ".ae-mcp-backup";

    [GeneratedRegex(@"^\d+(?:\.\d+)*$")]
    private static partial Regex VersionPattern();

    [GeneratedRegex(@"(?:^|[\r\n])[ \t]*""?" + ScriptingPrefKey + @"""?[ \t]*=[ \t]*""?(-?\d+)""?")]
    private static partial Regex ValuePattern();

    [GeneratedRegex(@"(^|[\r\n])([ \t]*""?" + ScriptingPrefKey + @"""?[ \t]*=[ \t]*""?)\d+(""?)")]
    private static partial Regex LinePattern();

    /// <summary><c>~/Library/Preferences/Adobe/After Effects</c> — where AE keeps its prefs.</summary>
    public static string AePrefsRoot(string? homeDir = null)
    {
        homeDir ??= Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        return Path.Combine(homeDir, "Library", "Preferences", "Adobe", "After Effects");
    }

    /// <summary>AE version folder, e.g. <c>26.5</c>, with its absolute path.</summary>
    public sealed record AEPrefsDir(string Version, string Dir);

    private static int CompareVersions(string a, string b)
    {
        var left = a.Split('.').Select(int.Parse).ToArray();
        var right = b.Split('.').Select(int.Parse).ToArray();
        for (var i = 0; i < Math.Max(left.Length, right.Length); i += 1)
        {
            var diff = (i < right.Length ? right[i] : 0) - (i < left.Length ? left[i] : 0);
            if (diff != 0)
            {
                return diff;
            }
        }

        return 0;
    }

    /// <summary>Lists AE version folders under <paramref name="aeDir"/>, newest first.</summary>
    public static IReadOnlyList<AEPrefsDir> DiscoverPrefsDirs(string? aeDir = null)
    {
        aeDir ??= AePrefsRoot();
        string[] entries;
        try
        {
            entries = Directory.GetDirectories(aeDir);
        }
        catch
        {
            return [];
        }

        return entries
            .Select(Path.GetFileName)
            .Where(name => name is not null && VersionPattern().IsMatch(name))
            .Select(name => name!)
            .OrderBy(name => name, Comparer<string>.Create(CompareVersions))
            .Select(version => new AEPrefsDir(version, Path.Combine(aeDir, version)))
            .ToArray();
    }

    /// <summary>Finds the single <c>… Prefs.txt</c> file in a version folder, or null.</summary>
    public static string? FindPrefsFile(string dir)
    {
        string[] entries;
        try
        {
            entries = Directory.GetFiles(dir);
        }
        catch
        {
            return null;
        }

        var match = entries.FirstOrDefault(path => Path.GetFileName(path).EndsWith("Prefs.txt", StringComparison.Ordinal));
        return match;
    }

    /// <summary>Reads the scripting file-access preference value, or null when unset.</summary>
    public static int? ReadScriptingPref(string content)
    {
        var match = ValuePattern().Match(content);
        return match.Success ? int.Parse(match.Groups[1].Value) : null;
    }

    /// <summary>The rewritten content plus what changed; mirrors the TS edit result.</summary>
    public sealed record ScriptingPrefEdit(string Content, bool Changed, bool Found);

    /// <summary>
    /// Sets <c>Pref_SCRIPTING_FILE_NETWORK_SECURITY</c> to <c>1</c>. When the key
    /// is missing it is inserted into the main pref section (created if absent).
    /// </summary>
    public static ScriptingPrefEdit SetScriptingPref(string content)
    {
        if (ReadScriptingPref(content) == 1)
        {
            return new ScriptingPrefEdit(content, false, true);
        }

        if (LinePattern().IsMatch(content))
        {
            var rewritten = LinePattern().Replace(content, m => $"{m.Groups[1].Value}{m.Groups[2].Value}1{m.Groups[3].Value}");
            return new ScriptingPrefEdit(rewritten, true, true);
        }

        var entry = $"\"{ScriptingPrefKey}\" = \"1\"";
        var sectionAt = content.IndexOf(MainPrefSection, StringComparison.Ordinal);
        if (sectionAt >= 0)
        {
            var rewritten = content[..(sectionAt + MainPrefSection.Length)] + "\n" + entry + content[(sectionAt + MainPrefSection.Length)..];
            return new ScriptingPrefEdit(rewritten, true, false);
        }

        return new ScriptingPrefEdit($"{content.TrimEnd()}\n{MainPrefSection}\n{entry}\n", true, false);
    }

    /// <summary>
    /// Enables the scripting file-access preference in <paramref name="prefsFile"/>,
    /// backing it up first and verifying the write. After Effects must be closed:
    /// it rewrites the prefs file on quit. Idempotent; never throws.
    /// </summary>
    public static async Task<EnableScriptingPrefResult> EnableScriptingPrefAsync(string prefsFile)
    {
        string content;
        try
        {
            content = await File.ReadAllTextAsync(prefsFile);
        }
        catch
        {
            return new EnableScriptingPrefResult(
                "scripting_pref", "fail", false, 0,
                "Open After Effects once so it writes its preferences, then run Setup again.");
        }

        var edit = SetScriptingPref(content);
        if (!edit.Changed)
        {
            return new EnableScriptingPrefResult("scripting_pref", "ok", false, 1);
        }

        var backup = $"{prefsFile}{BackupSuffix}";
        try
        {
            File.Copy(prefsFile, backup, overwrite: true);
            await File.WriteAllTextAsync(prefsFile, edit.Content);
        }
        catch
        {
            return new EnableScriptingPrefResult(
                "scripting_pref", "fail", false, 0,
                $"Grant write access to {prefsFile} and quit After Effects before retrying.");
        }

        var verify = ReadScriptingPref(await File.ReadAllTextAsync(prefsFile));
        if (verify != 1)
        {
            return new EnableScriptingPrefResult(
                "scripting_pref", "fail", false, verify ?? 0,
                "After Effects did not keep the scripting preference; set it by hand in Preferences > Scripting & Expressions.");
        }

        return new EnableScriptingPrefResult("scripting_pref", "ok", true, 1, Backup: backup);
    }

    /// <summary>
    /// Enables the scripting preference for the newest AE prefs folder, refusing
    /// while AE is running (it rewrites prefs on quit). The row carries
    /// <c>NeedsQuit = true</c> when AE must be quit and retried. Never throws.
    /// </summary>
    public static async Task<InstallerCheck> EnsureScriptingPrefAsync(
        string appName,
        string? prefsRoot = null,
        IsRunning? isRunning = null)
    {
        var dirs = DiscoverPrefsDirs(prefsRoot);
        if (dirs.Count == 0)
        {
            return new InstallerCheck(
                "scripting_pref", "fail",
                "Open After Effects once so it writes its preferences, then run Setup again.");
        }

        var newest = dirs[0];
        var probe = isRunning ?? AeProcess.IsAfterEffectsRunningAsync;
        if (await probe(appName))
        {
            return new InstallerCheck(
                "scripting_pref", "fail",
                "Quit After Effects (Cmd+Q), then click Retry.", NeedsQuit: true);
        }

        var prefsFile = FindPrefsFile(newest.Dir);
        if (prefsFile is null)
        {
            return new InstallerCheck(
                "scripting_pref", "fail",
                "Open After Effects once so it writes its preferences, then run Setup again.");
        }

        return await EnableScriptingPrefAsync(prefsFile);
    }
}
