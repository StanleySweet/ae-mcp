using Avalonia;
using System;

namespace AeMcpSetup;

class Program
{
    // Initialization code. Don't use any Avalonia, third-party APIs or any
    // SynchronizationContext-reliant code before AppMain is called: things aren't initialized
    // yet and stuff might break.
    // `--check` prints the read-only checklist (`--json` for JSON) and exits before any window opens.
    [STAThread]
    public static int Main(string[] args)
    {
        if (args.Contains("--check"))
        {
            return new SetupService().RunCheckAsync(args.Contains("--json"), Console.Out).GetAwaiter().GetResult();
        }

        return BuildAvaloniaApp().StartWithClassicDesktopLifetime(args);
    }

    // Avalonia configuration, don't remove; also used by visual designer.
    public static AppBuilder BuildAvaloniaApp()
        => AppBuilder.Configure<App>()
            .UsePlatformDetect()
            .WithInterFont()
            .LogToTrace();
}
