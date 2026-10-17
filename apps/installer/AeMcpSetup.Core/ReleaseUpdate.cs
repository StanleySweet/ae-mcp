using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace AeMcpSetup.Core;

/// <summary>
/// HTTP seam for the release check. Implementations throw on failure: an
/// <see cref="HttpRequestException"/> when offline, anything else for other errors.
/// </summary>
public interface IReleaseHttp
{
    Task<byte[]> GetBytesAsync(string url, CancellationToken cancellationToken);
}

/// <summary>Plain HTTPS GET for GitHub release assets (the API needs a User-Agent).</summary>
public sealed class HttpReleaseClient : IReleaseHttp
{
    private static readonly HttpClient Client = CreateClient();

    private static HttpClient CreateClient()
    {
        var client = new HttpClient { Timeout = ReleaseUpdate.DefaultTimeout };
        client.DefaultRequestHeaders.UserAgent.ParseAdd("ae-mcp-setup");
        client.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
        return client;
    }

    public Task<byte[]> GetBytesAsync(string url, CancellationToken cancellationToken)
        => Client.GetByteArrayAsync(url, cancellationToken);
}

/// <summary>
/// The bridge payload to install: the bundled one, or the newest GitHub release's
/// when it is newer and verifies. <see cref="Mcpb"/> is the verified release bundle
/// (null when the bundled payload is used); <see cref="Notice"/> is one line saying
/// why the bundled payload was kept, or null when nothing went wrong.
/// </summary>
public sealed record ReleasePayloadChoice(string Payload, string? Version, byte[]? Mcpb, string? Notice);

/// <summary>Picks the newest verified release payload, or falls back to the bundled one.</summary>
public static class ReleaseUpdate
{
    public const string LatestReleaseUrl = "https://api.github.com/repos/StanleySweet/ae-mcp/releases/latest";
    public const string McpbAssetName = "ae-mcp.mcpb";
    public const string SumsAssetName = "SHA256SUMS.txt";

    /// <summary>Path of the bridge payload inside the release bundle (see bundle/pack.ts).</summary>
    public const string PayloadEntry = "bridge/payload.jsx";

    public static readonly TimeSpan DefaultTimeout = TimeSpan.FromSeconds(10);

    /// <summary>Parses a release tag such as <c>v1.6.2</c> into a version, or null.</summary>
    public static Version? TagVersion(string tag)
    {
        var text = tag.TrimStart('v', 'V');
        var cut = text.IndexOfAny(['-', '+']);
        if (cut >= 0)
        {
            text = text[..cut];
        }

        return Version.TryParse(text, out var version) ? version : null;
    }

    /// <summary>
    /// Compares the newest release with <paramref name="bundled"/>. Only a newer,
    /// verified release is used. Never throws: every failure falls back.
    /// </summary>
    public static async Task<ReleasePayloadChoice> ChooseAsync(
        string bundled,
        IReleaseHttp http,
        string latestUrl = LatestReleaseUrl,
        TimeSpan? timeout = null)
    {
        var bundledText = InstallPayload.PayloadVersion(bundled);
        if (bundledText is null || !Version.TryParse(bundledText, out var bundledVersion))
        {
            return new ReleasePayloadChoice(bundled, bundledText, null, null);
        }

        var limit = timeout ?? DefaultTimeout;

        async Task<byte[]> Fetch(string url)
        {
            var pending = http.GetBytesAsync(url, CancellationToken.None);
            return await pending.WaitAsync(limit);
        }

        string tag = "";
        try
        {
            var release = ParseRelease(await Fetch(latestUrl));
            tag = release.Tag;
            var latest = TagVersion(release.Tag);
            if (latest is null)
            {
                return Fallback(bundled, bundledVersion, "Could not read the latest release");
            }

            if (latest <= bundledVersion)
            {
                return new ReleasePayloadChoice(bundled, bundledText, null, null);
            }

            if (!release.Assets.TryGetValue(McpbAssetName, out var mcpbUrl)
                || !release.Assets.TryGetValue(SumsAssetName, out var sumsUrl))
            {
                return Fallback(bundled, bundledVersion, $"Release {release.Tag} has no {McpbAssetName}");
            }

            var mcpb = await Fetch(mcpbUrl);
            var sums = await Fetch(sumsUrl);
            var expected = FindSha256(Encoding.UTF8.GetString(sums), McpbAssetName);
            if (expected is null)
            {
                return Fallback(bundled, bundledVersion, $"{SumsAssetName} has no entry for {McpbAssetName}");
            }

            if (!string.Equals(expected, Sha256(mcpb), StringComparison.Ordinal))
            {
                return Fallback(bundled, bundledVersion, $"Checksum mismatch for {McpbAssetName}");
            }

            var payload = ExtractPayload(mcpb);
            var payloadVersion = payload is null ? null : InstallPayload.PayloadVersion(payload);
            if (payload is null || payloadVersion is null)
            {
                return Fallback(bundled, bundledVersion, $"{McpbAssetName} has no bridge payload");
            }

            return new ReleasePayloadChoice(payload, payloadVersion, mcpb, null);
        }
        catch (HttpRequestException)
        {
            return Fallback(bundled, bundledVersion, "Offline");
        }
        catch (TimeoutException)
        {
            return Fallback(bundled, bundledVersion, "Release check timed out");
        }
        catch (Exception error) when (error is JsonException or KeyNotFoundException or InvalidDataException
            or InvalidOperationException or FormatException)
        {
            return Fallback(bundled, bundledVersion, tag.Length == 0
                ? "Could not read the latest release"
                : $"Could not read release {tag}");
        }
    }

    private static ReleasePayloadChoice Fallback(string bundled, Version bundledVersion, string reason)
        => new(bundled, bundledVersion.ToString(), null,
            $"{reason}, installed the bundled bridge {bundledVersion}.");

    private static (string Tag, Dictionary<string, string> Assets) ParseRelease(byte[] json)
    {
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        var tag = root.GetProperty("tag_name").GetString() ?? throw new FormatException("no tag");
        var assets = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var asset in root.GetProperty("assets").EnumerateArray())
        {
            var name = asset.GetProperty("name").GetString();
            var url = asset.GetProperty("browser_download_url").GetString();
            if (name is not null && url is not null)
            {
                assets[name] = url;
            }
        }

        return (tag, assets);
    }

    /// <summary>Reads a <c>sha256sum</c>-style file (<c>hash  name</c> per line) for one file name.</summary>
    public static string? FindSha256(string sums, string name)
    {
        foreach (var raw in sums.Split('\n'))
        {
            var line = raw.Trim();
            var space = line.IndexOf(' ', StringComparison.Ordinal);
            if (space <= 0)
            {
                continue;
            }

            var file = line[(space + 1)..].TrimStart(' ', '*');
            if (file == name)
            {
                return line[..space].ToLowerInvariant();
            }
        }

        return null;
    }

    private static string Sha256(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();

    /// <summary>Returns the bridge payload text from the bundle, or null when the bundle lacks it.</summary>
    private static string? ExtractPayload(byte[] mcpb)
    {
        using var stream = new MemoryStream(mcpb);
        using var archive = new ZipArchive(stream, ZipArchiveMode.Read);
        var entry = archive.GetEntry(PayloadEntry);
        if (entry is null)
        {
            return null;
        }

        using var reader = new StreamReader(entry.Open(), Encoding.UTF8);
        return reader.ReadToEnd();
    }
}
