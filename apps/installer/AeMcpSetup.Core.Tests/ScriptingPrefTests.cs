using AeMcpSetup.Core;

namespace AeMcpSetup.Core.Tests;

public class ScriptingPrefTests
{
    private static readonly string Prefs = string.Join('\n', new[]
    {
        "[Main Pref Section v2]",
        $"\"{ScriptingPref.ScriptingPrefKey}\" = \"0\"",
        "\"Pref_OTHER\" = \"3\"",
        "",
    });

    [Fact]
    public void ReadsTheCurrentValue()
    {
        Assert.Equal(0, ScriptingPref.ReadScriptingPref(Prefs));
        Assert.Equal(1, ScriptingPref.ReadScriptingPref($"\"{ScriptingPref.ScriptingPrefKey}\" = \"1\""));
    }

    [Fact]
    public void ReturnsNullWhenTheKeyIsAbsent()
    {
        Assert.Null(ScriptingPref.ReadScriptingPref("[Main Pref Section v2]\n"));
    }

    [Fact]
    public void EnablesAnExistingKeyPreservingTheRestOfTheFile()
    {
        var edit = ScriptingPref.SetScriptingPref(Prefs);

        Assert.True(edit.Changed);
        Assert.True(edit.Found);
        Assert.Equal(1, ScriptingPref.ReadScriptingPref(edit.Content));
        Assert.Contains("\"Pref_OTHER\" = \"3\"", edit.Content);
    }

    [Fact]
    public void IsANoOpWhenAlreadyEnabled()
    {
        var enabled = $"\"{ScriptingPref.ScriptingPrefKey}\" = \"1\"";
        var edit = ScriptingPref.SetScriptingPref(enabled);

        Assert.False(edit.Changed);
        Assert.True(edit.Found);
    }

    [Fact]
    public void InsertsTheKeyIntoTheMainSectionWhenMissing()
    {
        var edit = ScriptingPref.SetScriptingPref("[Main Pref Section v2]\n");

        Assert.True(edit.Changed);
        Assert.False(edit.Found);
        Assert.Equal(1, ScriptingPref.ReadScriptingPref(edit.Content));
        Assert.Contains("[Main Pref Section v2]", edit.Content);
    }

    [Fact]
    public void DiscoverPrefsDirsListsVersionFoldersNewestFirst()
    {
        var root = TempDir.Create("ae-mcp-prefs-");
        Directory.CreateDirectory(Path.Combine(root, "25.1"));
        Directory.CreateDirectory(Path.Combine(root, "26.5"));
        Directory.CreateDirectory(Path.Combine(root, "not-a-version"));

        var dirs = ScriptingPref.DiscoverPrefsDirs(root);

        Assert.Equal(["26.5", "25.1"], dirs.Select(d => d.Version));
        Assert.Equal(Path.Combine(root, "26.5"), dirs[0].Dir);
    }

    [Fact]
    public void DiscoverPrefsDirsReturnsEmptyWhenNothingIsInstalled()
    {
        Assert.Empty(ScriptingPref.DiscoverPrefsDirs(TempDir.Create("ae-mcp-prefs-")));
    }

    [Fact]
    public void AePrefsRootPointsUnderLibraryPreferencesAdobe()
    {
        Assert.Equal(
            Path.Combine("/Users/example", "Library", "Preferences", "Adobe", "After Effects"),
            ScriptingPref.AePrefsRoot("/Users/example"));
    }

    [Fact]
    public async Task FindPrefsFileFindsThePrefsTxtInAVersionFolder()
    {
        var dir = TempDir.Create("ae-mcp-prefs-");
        await File.WriteAllTextAsync(Path.Combine(dir, "Adobe After Effects 26.5 Prefs.txt"), Prefs);

        Assert.Equal(Path.Combine(dir, "Adobe After Effects 26.5 Prefs.txt"), ScriptingPref.FindPrefsFile(dir));
    }

    [Fact]
    public void FindPrefsFileReturnsNullWhenThereIsNoPrefsFile()
    {
        Assert.Null(ScriptingPref.FindPrefsFile(TempDir.Create("ae-mcp-prefs-")));
    }

    [Fact]
    public async Task EnableScriptingPrefBacksUpEnablesAndVerifies()
    {
        var dir = TempDir.Create("ae-mcp-prefs-");
        var prefsFile = Path.Combine(dir, "Adobe After Effects 26.5 Prefs.txt");
        await File.WriteAllTextAsync(prefsFile, Prefs);

        var result = await ScriptingPref.EnableScriptingPrefAsync(prefsFile);

        Assert.Equal("scripting_pref", result.Check);
        Assert.Equal("ok", result.Status);
        Assert.True(result.Changed);
        Assert.Equal(1, result.Value);
        Assert.Equal(1, ScriptingPref.ReadScriptingPref(await File.ReadAllTextAsync(prefsFile)));
        Assert.NotNull(result.Backup);
        Assert.Equal(Prefs, await File.ReadAllTextAsync(result.Backup!));
    }

    [Fact]
    public async Task EnableScriptingPrefIsIdempotentAndLeavesNoBackupWhenAlreadyEnabled()
    {
        var dir = TempDir.Create("ae-mcp-prefs-");
        var prefsFile = Path.Combine(dir, "Adobe After Effects 26.5 Prefs.txt");
        await File.WriteAllTextAsync(prefsFile, $"\"{ScriptingPref.ScriptingPrefKey}\" = \"1\"");

        var result = await ScriptingPref.EnableScriptingPrefAsync(prefsFile);

        Assert.Equal("ok", result.Status);
        Assert.False(result.Changed);
        Assert.Equal(1, result.Value);
        Assert.Null(result.Backup);
    }

    [Fact]
    public async Task EnableScriptingPrefReportsAFixWhenThePrefsFileIsMissing()
    {
        var dir = TempDir.Create("ae-mcp-prefs-");
        var result = await ScriptingPref.EnableScriptingPrefAsync(Path.Combine(dir, "nope Prefs.txt"));

        Assert.Equal("fail", result.Status);
        Assert.False(string.IsNullOrEmpty(result.Fix));
    }

    private static string PrefsRootWithFile()
    {
        var root = TempDir.Create("ae-mcp-prefs-");
        var dir = Path.Combine(root, "26.5");
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "Adobe After Effects 26.5 Prefs.txt"), Prefs);
        return root;
    }

    [Fact]
    public async Task EnsureScriptingPrefAsksToQuitAfterEffectsWhenItIsRunning()
    {
        var result = await ScriptingPref.EnsureScriptingPrefAsync(
            "Adobe After Effects 2026",
            PrefsRootWithFile(),
            _ => Task.FromResult(true));

        Assert.Equal("scripting_pref", result.Check);
        Assert.Equal("fail", result.Status);
        Assert.True(result.NeedsQuit);
    }

    [Fact]
    public async Task EnsureScriptingPrefEnablesThePrefOnceAfterEffectsIsQuit()
    {
        var root = PrefsRootWithFile();

        var result = await ScriptingPref.EnsureScriptingPrefAsync(
            "Adobe After Effects 2026",
            root,
            _ => Task.FromResult(false));

        Assert.Equal("scripting_pref", result.Check);
        Assert.Equal("ok", result.Status);
        Assert.Equal(1, ScriptingPref.ReadScriptingPref(
            await File.ReadAllTextAsync(Path.Combine(root, "26.5", "Adobe After Effects 26.5 Prefs.txt"))));
    }

    [Fact]
    public async Task EnsureScriptingPrefReportsAFixWhenNoAePrefsFolderExists()
    {
        var result = await ScriptingPref.EnsureScriptingPrefAsync(
            "Adobe After Effects 2026",
            TempDir.Create("ae-mcp-prefs-"),
            _ => Task.FromResult(false));

        Assert.Equal("scripting_pref", result.Check);
        Assert.Equal("fail", result.Status);
        Assert.False(string.IsNullOrEmpty(result.Fix));
    }
}
