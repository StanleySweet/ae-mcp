using AeMcpSetup.Core;

namespace AeMcpSetup.Core.Tests;

public class AeProcessTests
{
    [Fact]
    public async Task ReturnsFalseWhenNoMatchingProcessIsRunning()
    {
        Assert.False(await AeProcess.IsAfterEffectsRunningAsync("ae-mcp-nonexistent-process-9f3a"));
    }
}
