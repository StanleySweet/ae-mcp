using System.Diagnostics;

namespace AeMcpSetup.Core;

public sealed record ShellResult(int ExitCode, string Stdout, string Stderr);

/// <summary>Runs macOS command-line tools, optionally with a timeout.</summary>
public static class Shell
{
    /// <summary>
    /// Runs a command, bounded by <paramref name="timeoutMs"/> when set. On
    /// timeout the child is killed and a <see cref="TimeoutException"/> is thrown.
    /// </summary>
    public static async Task<ShellResult> RunAsync(
        string file,
        IReadOnlyList<string> args,
        int? timeoutMs = null,
        CancellationToken ct = default)
    {
        var startInfo = new ProcessStartInfo(file)
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        foreach (var arg in args)
        {
            startInfo.ArgumentList.Add(arg);
        }

        using var proc = new Process { StartInfo = startInfo };
        proc.Start();

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        if (timeoutMs is > 0)
        {
            cts.CancelAfter(timeoutMs.Value);
        }

        try
        {
            var stdout = proc.StandardOutput.ReadToEndAsync();
            var stderr = proc.StandardError.ReadToEndAsync();
            await proc.WaitForExitAsync(cts.Token);
            return new ShellResult(proc.ExitCode, await stdout, await stderr);
        }
        catch (OperationCanceledException)
        {
            try
            {
                proc.Kill(entireProcessTree: true);
            }
            catch
            {
                // already gone
            }

            throw new TimeoutException($"{file} timed out after {timeoutMs}ms");
        }
    }

    /// <summary>Runs a command and returns whether it exited 0 (any failure is false).</summary>
    public static async Task<bool> SucceedsAsync(string file, IReadOnlyList<string> args, int? timeoutMs = null)
    {
        try
        {
            var result = await RunAsync(file, args, timeoutMs);
            return result.ExitCode == 0;
        }
        catch
        {
            return false;
        }
    }
}
