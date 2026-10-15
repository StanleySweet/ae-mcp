namespace AeMcpSetup.Core.Tests;

/// <summary>Creates throwaway directories for filesystem-touching tests.</summary>
public static class TempDir
{
    public static string Create(string prefix = "ae-mcp-")
    {
        var dir = Path.Combine(Path.GetTempPath(), $"{prefix}{Guid.NewGuid():N}");
        Directory.CreateDirectory(dir);
        return dir;
    }
}
