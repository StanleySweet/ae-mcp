namespace AeMcpSetup.Core;

public sealed record HandMcpbResult(
    string Check,
    string Status,
    bool Handed,
    string Path,
    string? Fix = null,
    bool? NeedsQuit = null) : InstallerCheck(Check, Status, Fix, NeedsQuit);

/// <summary>Opens <c>path</c> with Claude Desktop. Returns whether it succeeded.</summary>
public delegate Task<bool> OpenWithClaude(string path);

/// <summary>Hands the bundled <c>.mcpb</c> to Claude Desktop.</summary>
public static class InstallMcpb
{
    /// <summary>Arguments for <c>open</c> that hand a bundle to Claude Desktop (macOS).</summary>
    public static string[] ClaudeOpenArgs(string path) => ["-a", "Claude", path];

    public static Task<bool> OpenWithClaudeAsync(string path)
        => Shell.SucceedsAsync("open", ClaudeOpenArgs(path));

    /// <summary>
    /// Hands the bundled <c>.mcpb</c> to Claude Desktop so it shows its install
    /// prompt. Idempotent in the sense that installing the same bundle again just
    /// reopens the prompt.
    /// </summary>
    public static async Task<HandMcpbResult> HandToClaudeAsync(
        string mcpbPath,
        ClaudeDesktopInstall? claude,
        OpenWithClaude? openFile = null)
    {
        if (claude is null)
        {
            return new HandMcpbResult(
                "claude_extension", "fail", false, mcpbPath,
                "Install Claude Desktop from https://claude.ai/download and sign in.");
        }

        if (!File.Exists(mcpbPath))
        {
            return new HandMcpbResult(
                "claude_extension", "fail", false, mcpbPath,
                $"The ae-mcp bundle is missing at {mcpbPath}; rebuild it with npm run bundle:pack.");
        }

        var open = openFile ?? OpenWithClaudeAsync;
        if (!await open(mcpbPath))
        {
            return new HandMcpbResult(
                "claude_extension", "fail", false, mcpbPath,
                "Open Claude Desktop, then Settings > Extensions > Advanced > Install extension and pick ae-mcp.mcpb.");
        }

        return new HandMcpbResult("claude_extension", "ok", true, mcpbPath);
    }
}
