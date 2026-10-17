using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using AeMcpSetup.Core;

namespace AeMcpSetup.Core.Tests;

/// <summary>Serves canned bodies by URL. Unknown URLs fail like an offline network.</summary>
internal sealed class FakeReleaseHttp : IReleaseHttp
{
    private readonly Dictionary<string, Func<Task<byte[]>>> _routes = new();

    public List<string> Requested { get; } = [];

    public FakeReleaseHttp On(string url, byte[] body)
    {
        _routes[url] = () => Task.FromResult(body);
        return this;
    }

    public FakeReleaseHttp On(string url, Func<Task<byte[]>> body)
    {
        _routes[url] = body;
        return this;
    }

    public Task<byte[]> GetBytesAsync(string url, CancellationToken cancellationToken)
    {
        Requested.Add(url);
        if (_routes.TryGetValue(url, out var body))
        {
            return body();
        }

        throw new HttpRequestException("no route for " + url);
    }
}

public class ReleaseUpdateTests
{
    private const string LatestUrl = "https://api.github.com/repos/StanleySweet/ae-mcp/releases/latest";
    private const string McpbUrl = "https://example.test/ae-mcp.mcpb";
    private const string SumsUrl = "https://example.test/SHA256SUMS.txt";
    private const string Bundled = "var AEMCP_BRIDGE_VERSION = \"1.6.2\";\n";

    private static byte[] Utf8(string text) => Encoding.UTF8.GetBytes(text);

    private static string Sha256(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();

    /// <summary>A zip shaped like the release bundle: a manifest and, optionally, the bridge payload.</summary>
    private static byte[] Mcpb(string? payload)
    {
        using var stream = new MemoryStream();
        using (var archive = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
        {
            using (var manifest = new StreamWriter(archive.CreateEntry("manifest.json").Open()))
            {
                manifest.Write("{}");
            }

            if (payload is not null)
            {
                using var writer = new StreamWriter(archive.CreateEntry("bridge/payload.jsx").Open());
                writer.Write(payload);
            }
        }

        return stream.ToArray();
    }

    private static byte[] Latest(string tag, bool withMcpb = true)
    {
        var mcpbAsset = withMcpb
            ? $"{{\"name\":\"ae-mcp.mcpb\",\"browser_download_url\":\"{McpbUrl}\"}},"
            : "";
        return Utf8($"{{\"tag_name\":\"{tag}\",\"assets\":[{mcpbAsset}"
            + $"{{\"name\":\"SHA256SUMS.txt\",\"browser_download_url\":\"{SumsUrl}\"}}]}}");
    }

    private static byte[] Sums(string name, byte[] mcpb) => Utf8($"{Sha256(mcpb)}  {name}\n");

    private static FakeReleaseHttp Release(string tag, byte[] mcpb, byte[]? sums = null)
        => new FakeReleaseHttp()
            .On(LatestUrl, Latest(tag))
            .On(McpbUrl, mcpb)
            .On(SumsUrl, sums ?? Sums("ae-mcp.mcpb", mcpb));

    [Fact]
    public async Task UsesTheNewerReleasePayload()
    {
        var mcpb = Mcpb("var AEMCP_BRIDGE_VERSION = \"1.7.0\";\n");
        var http = Release("v1.7.0", mcpb);

        var choice = await ReleaseUpdate.ChooseAsync(Bundled, http, LatestUrl);

        Assert.Contains("1.7.0", choice.Payload);
        Assert.Equal("1.7.0", choice.Version);
        Assert.NotNull(choice.Mcpb);
        Assert.Null(choice.Notice);
    }

    [Fact]
    public async Task SkipsTheDownloadWhenTheReleaseIsNotNewer()
    {
        var mcpb = Mcpb("var AEMCP_BRIDGE_VERSION = \"1.6.2\";\n");
        var http = Release("v1.6.2", mcpb);

        var choice = await ReleaseUpdate.ChooseAsync(Bundled, http, LatestUrl);

        Assert.Equal(Bundled, choice.Payload);
        Assert.Null(choice.Mcpb);
        Assert.Null(choice.Notice);
        Assert.Equal([LatestUrl], http.Requested);
    }

    [Fact]
    public async Task FallsBackToTheBundledPayloadWhenOffline()
    {
        var http = new FakeReleaseHttp();

        var choice = await ReleaseUpdate.ChooseAsync(Bundled, http, LatestUrl);

        Assert.Equal(Bundled, choice.Payload);
        Assert.Null(choice.Mcpb);
        Assert.Equal("Offline, installed the bundled bridge 1.6.2.", choice.Notice);
    }

    [Fact]
    public async Task FallsBackWhenTheReleaseCheckTimesOut()
    {
        var http = new FakeReleaseHttp().On(LatestUrl, () => new TaskCompletionSource<byte[]>().Task);

        var choice = await ReleaseUpdate.ChooseAsync(Bundled, http, LatestUrl, TimeSpan.FromMilliseconds(50));

        Assert.Equal(Bundled, choice.Payload);
        Assert.Equal("Release check timed out, installed the bundled bridge 1.6.2.", choice.Notice);
    }

    [Fact]
    public async Task FallsBackOnAChecksumMismatch()
    {
        var mcpb = Mcpb("var AEMCP_BRIDGE_VERSION = \"1.7.0\";\n");
        var wrong = Utf8($"{new string('0', 64)}  ae-mcp.mcpb\n");
        var http = Release("v1.7.0", mcpb, wrong);

        var choice = await ReleaseUpdate.ChooseAsync(Bundled, http, LatestUrl);

        Assert.Equal(Bundled, choice.Payload);
        Assert.Null(choice.Mcpb);
        Assert.Equal("Checksum mismatch for ae-mcp.mcpb, installed the bundled bridge 1.6.2.", choice.Notice);
    }

    [Fact]
    public async Task FallsBackWhenTheReleaseHasNoMcpbAsset()
    {
        var http = new FakeReleaseHttp().On(LatestUrl, Latest("v1.7.0", withMcpb: false));

        var choice = await ReleaseUpdate.ChooseAsync(Bundled, http, LatestUrl);

        Assert.Equal(Bundled, choice.Payload);
        Assert.Equal("Release v1.7.0 has no ae-mcp.mcpb, installed the bundled bridge 1.6.2.", choice.Notice);
    }

    [Fact]
    public async Task FallsBackWhenTheBundleHasNoPayload()
    {
        var http = Release("v1.7.0", Mcpb(payload: null));

        var choice = await ReleaseUpdate.ChooseAsync(Bundled, http, LatestUrl);

        Assert.Equal(Bundled, choice.Payload);
        Assert.Equal("ae-mcp.mcpb has no bridge payload, installed the bundled bridge 1.6.2.", choice.Notice);
    }

    [Fact]
    public async Task FallsBackWhenTheSumsFileHasNoEntry()
    {
        var mcpb = Mcpb("var AEMCP_BRIDGE_VERSION = \"1.7.0\";\n");
        var http = Release("v1.7.0", mcpb, Utf8($"{Sha256(mcpb)}  other.zip\n"));

        var choice = await ReleaseUpdate.ChooseAsync(Bundled, http, LatestUrl);

        Assert.Equal(Bundled, choice.Payload);
        Assert.Equal("SHA256SUMS.txt has no entry for ae-mcp.mcpb, installed the bundled bridge 1.6.2.", choice.Notice);
    }

    [Fact]
    public void TagVersionIgnoresAReleasePrefix()
    {
        Assert.Equal(new Version(1, 7, 0), ReleaseUpdate.TagVersion("v1.7.0"));
        Assert.Equal(new Version(1, 6, 2), ReleaseUpdate.TagVersion("1.6.2"));
        Assert.Null(ReleaseUpdate.TagVersion("latest"));
    }
}
