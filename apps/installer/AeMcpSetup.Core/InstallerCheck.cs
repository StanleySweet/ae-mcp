namespace AeMcpSetup.Core;

/// <summary>One installer step's outcome, shaped for the Setup checklist.</summary>
public record InstallerCheck(string Check, string Status, string? Fix = null, bool? NeedsQuit = null)
{
    public const string OkStatus = "ok";
    public const string FailStatus = "fail";

    public bool IsOk => Status == OkStatus;
}

/// <summary>Small filesystem helpers shared by the installer steps.</summary>
public static class Io
{
    /// <summary>Reads a file as UTF-8, or null when it is missing/unreadable.</summary>
    public static async Task<string?> ReadFileOrNullAsync(string path)
    {
        try
        {
            return await File.ReadAllTextAsync(path);
        }
        catch
        {
            return null;
        }
    }
}
