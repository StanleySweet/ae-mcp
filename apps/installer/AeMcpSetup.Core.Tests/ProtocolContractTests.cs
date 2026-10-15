using System.Text.Json;
using AeMcpSetup.Core;

namespace AeMcpSetup.Core.Tests;

/// <summary>
/// Pins the job/result JSON the native BridgeCall speaks against the shared
/// fixtures also asserted by the TS suite (packages/protocol/src/contract.test.ts).
/// </summary>
public class ProtocolContractTests
{
    private static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null &&
               !File.Exists(Path.Combine(dir.FullName, "packages", "protocol", "contract", "job.json")))
        {
            dir = dir.Parent;
        }

        Assert.NotNull(dir);
        return dir!.FullName;
    }

    private static JsonElement Fixture(string name)
        => JsonDocument
            .Parse(File.ReadAllText(Path.Combine(RepoRoot(), "packages", "protocol", "contract", name)))
            .RootElement;

    [Fact]
    public void BridgeCallJobHasExactlyTheFieldsTheFixtureDeclares()
    {
        var fixtureKeys = Fixture("job.json").EnumerateObject().Select(p => p.Name).OrderBy(n => n).ToArray();
        var jobKeys = BridgeCall.BuildJob("id", "comp.create", null, 0).Keys.OrderBy(n => n).ToArray();

        Assert.Equal(fixtureKeys, jobKeys);
        Assert.Equal(BridgeCall.ProtocolVersion, Fixture("job.json").GetProperty("protocolVersion").GetInt32());
    }

    [Fact]
    public void ResultFixtureIsReadableByTheOkCheck()
    {
        var result = Fixture("result.json");
        var ok = result.TryGetProperty("ok", out var okProp) && okProp.ValueKind == JsonValueKind.True;

        Assert.True(ok);
        Assert.Equal(BridgeCall.ProtocolVersion, result.GetProperty("protocolVersion").GetInt32());
    }
}
