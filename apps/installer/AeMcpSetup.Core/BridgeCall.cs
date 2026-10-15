using System.Text.Json;

namespace AeMcpSetup.Core;

/// <summary>
/// Transport B (ADR 0001): runs one job in the open After Effects per call via
/// osascript <c>DoScriptFile</c>. The job's result is delivered through the
/// outbox file and read back here. Job files live in <c>jobs/</c>, not
/// <c>inbox/</c>: the startup loader (transport A) polls <c>inbox/</c>, so
/// writing there would let it steal the job before the trigger reads it.
/// </summary>
public sealed class BridgeCall
{
    public const int ProtocolVersion = 1;

    private readonly string _root;
    private readonly string _appName;
    private readonly int _timeoutMs;

    public BridgeCall(string root, string appName, int timeoutMs = 120_000)
    {
        _root = root;
        _appName = appName;
        _timeoutMs = timeoutMs;
    }

    /// <summary>
    /// The job envelope written to <c>jobs/&lt;id&gt;.json</c>. Public so the
    /// protocol contract test can pin its shape against a shared fixture.
    /// </summary>
    public static Dictionary<string, object?> BuildJob(
        string id,
        string tool,
        IReadOnlyDictionary<string, object?>? args,
        long deadline) => new()
        {
            ["protocolVersion"] = ProtocolVersion,
            ["id"] = id,
            ["tool"] = tool,
            ["args"] = args,
            ["deadline"] = deadline,
        };

    /// <summary>Runs one bridge operation and reports whether it succeeded.</summary>
    public async Task<bool> CallAsync(string tool, IReadOnlyDictionary<string, object?>? args = null)
    {
        var id = Guid.NewGuid().ToString();
        var bridgeDir = Path.Combine(_root, "bridge");
        var jobsDir = Path.Combine(bridgeDir, "jobs");
        var outboxDir = Path.Combine(bridgeDir, "outbox");
        Directory.CreateDirectory(jobsDir);
        Directory.CreateDirectory(outboxDir);

        var jobFile = Path.Combine(jobsDir, $"{id}.json");
        var triggerFile = Path.Combine(jobsDir, $"{id}.jsx");
        var resultFile = Path.Combine(outboxDir, $"{id}.json");
        var payloadPath = Path.Combine(bridgeDir, "current.jsx");

        var deadline = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + _timeoutMs;
        var job = BuildJob(id, tool, args, deadline);
        await WriteAtomicAsync(jobFile, JsonSerializer.Serialize(job));

        var trigger =
            $"$.evalFile({JsonSerializer.Serialize(payloadPath)});\nAEMCP.processJob({JsonSerializer.Serialize(jobFile)});\n";
        await WriteAtomicAsync(triggerFile, trigger);

        try
        {
            await Shell.RunAsync(
                "osascript",
                ["-e", $"tell application \"{_appName}\" to DoScriptFile \"{triggerFile}\""],
                _timeoutMs);
        }
        catch (TimeoutException)
        {
            TryDelete(jobFile);
            return false;
        }
        catch
        {
            TryDelete(jobFile);
            return false;
        }
        finally
        {
            TryDelete(triggerFile);
        }

        try
        {
            using var doc = JsonDocument.Parse(await File.ReadAllTextAsync(resultFile));
            var ok = doc.RootElement.TryGetProperty("ok", out var okProp) && okProp.ValueKind == JsonValueKind.True;
            TryDelete(resultFile);
            return ok;
        }
        catch
        {
            return false;
        }
    }

    private static Task WriteAtomicAsync(string path, string contents)
    {
        var tmp = $"{path}.{Guid.NewGuid():N}.tmp";
        File.WriteAllText(tmp, contents);
        File.Move(tmp, path, overwrite: true);
        return Task.CompletedTask;
    }

    private static void TryDelete(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch
        {
            // already gone
        }
    }
}
