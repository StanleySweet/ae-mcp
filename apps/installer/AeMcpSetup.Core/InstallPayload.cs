namespace AeMcpSetup.Core;

public sealed record InstallPayloadResult(
    string Check,
    string Status,
    string Version,
    bool Changed,
    string? Fix = null,
    bool? NeedsQuit = null) : InstallerCheck(Check, Status, Fix, NeedsQuit);

/// <summary>Installs the bridge payload at <c>&lt;root&gt;/bridge/current.jsx</c>.</summary>
public static class InstallPayload
{
    private const string VersionMarker = "AEMCP_BRIDGE_VERSION = \"";

    /// <summary>The queue holds job payloads, so it stays owner-only (0700).</summary>
    private static readonly UnixFileMode QueueMode =
        UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute;

    /// <summary>Reads the bridge version from the generated payload's stamp, or null.</summary>
    public static string? PayloadVersion(string source)
    {
        var at = source.IndexOf(VersionMarker, StringComparison.Ordinal);
        if (at < 0)
        {
            return null;
        }

        var start = at + VersionMarker.Length;
        var end = source.IndexOf('"', start);
        if (end < 0)
        {
            return null;
        }

        return source[start..end];
    }

    /// <summary>
    /// Installs the bridge payload at <c>&lt;root&gt;/bridge/current.jsx</c>,
    /// creating the bridge folders. Safe to run repeatedly: a matching payload is
    /// left untouched (<c>Changed=false</c>). Never throws — failures come back as
    /// a <c>fix</c> row.
    /// </summary>
    public static async Task<InstallPayloadResult> InstallAsync(string root, string payload)
    {
        var version = PayloadVersion(payload);
        if (version is null)
        {
            return new InstallPayloadResult(
                "bridge_payload", "fail", "", false,
                "The bridge payload is missing its version stamp; rebuild with npm run bridge:build.");
        }

        var bridgeDir = Path.Combine(root, "bridge");
        try
        {
            // Keep the queue owner-only (0700): check_setup verifies this, so create
            // it right here rather than relying on the server's lazy repair.
            Directory.CreateDirectory(root);
            File.SetUnixFileMode(root, QueueMode);
            Directory.CreateDirectory(Path.Combine(bridgeDir, "inbox"), QueueMode);
            Directory.CreateDirectory(Path.Combine(bridgeDir, "outbox"), QueueMode);
            var currentPath = Path.Combine(bridgeDir, "current.jsx");
            var previous = await Io.ReadFileOrNullAsync(currentPath);
            var changed = previous != payload;
            if (changed)
            {
                await File.WriteAllTextAsync(currentPath, payload);
            }

            return new InstallPayloadResult("bridge_payload", "ok", version, changed);
        }
        catch
        {
            return new InstallPayloadResult(
                "bridge_payload", "fail", version, false,
                $"Grant write access to {root}, or rerun the ae-mcp Setup app.");
        }
    }
}
