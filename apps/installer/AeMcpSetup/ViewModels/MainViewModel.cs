using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using AeMcpSetup.Core;

namespace AeMcpSetup.ViewModels;

/// <summary>Backs the Setup window: the six checklist rows plus the action buttons.</summary>
public sealed class MainViewModel : INotifyPropertyChanged
{
    private readonly SetupService _service;
    private DetectedEnvironment? _environment;

    private string _subtitle = "Checking your Mac…";
    private string _progress = "";
    private string _installStatus = "";
    private bool _busy;

    public MainViewModel(SetupService service)
    {
        _service = service;
        InstallCommand = new RelayCommand(InstallAsync, () => !_busy);
        UninstallCommand = new RelayCommand(UninstallAsync, () => !_busy);
        DiagnosticsCommand = new RelayCommand(DiagnosticsAsync, () => !_busy);

        foreach (var item in Checklist.Items)
        {
            Rows.Add(new ChecklistRowViewModel(item.Id, item.Label));
        }
    }

    public ObservableCollection<ChecklistRowViewModel> Rows { get; } = [];

    public RelayCommand InstallCommand { get; }

    public RelayCommand UninstallCommand { get; }

    public RelayCommand DiagnosticsCommand { get; }

    public event PropertyChangedEventHandler? PropertyChanged;

    public string Subtitle
    {
        get => _subtitle;
        private set => Set(ref _subtitle, value);
    }

    public string Progress
    {
        get => _progress;
        private set => Set(ref _progress, value);
    }

    /// <summary>"Fresh install", "Update from X to Y" or "Up to date"; empty until After Effects is found.</summary>
    public string InstallStatus
    {
        get => _installStatus;
        private set => Set(ref _installStatus, value);
    }

    public bool Busy
    {
        get => _busy;
        private set
        {
            if (Set(ref _busy, value))
            {
                InstallCommand.RaiseCanExecuteChanged();
                UninstallCommand.RaiseCanExecuteChanged();
                DiagnosticsCommand.RaiseCanExecuteChanged();
            }
        }
    }

    public async Task InitializeAsync()
    {
        _environment = await _service.DetectAsync();
        Apply(Checklist.Build(_environment));
        Subtitle = Summarize(_environment);
        var ae = _environment.AfterEffects.FirstOrDefault();
        if (ae is not null)
        {
            InstallStatus = InstallDetector.Describe(await _service.DetectInstallAsync(ae));
        }
    }

    private async Task InstallAsync()
    {
        Busy = true;
        Progress = "Installing… approve the macOS admin prompt to install the After Effects helper.";
        try
        {
            var result = await _service.RepairAsync();
            if (_environment is not null)
            {
                Apply(Checklist.Build(_environment, result.Checks));
            }

            Progress = result.Ok ? "Everything is set up." : "Some steps need attention.";
        }
        finally
        {
            Busy = false;
        }
    }

    private async Task UninstallAsync()
    {
        Busy = true;
        Progress = "Removing the bridge…";
        try
        {
            var result = await _service.UninstallAsync();
            Progress = result.IsOk
                ? $"Removed {result.Removed.Count} file(s)."
                : result.Fix ?? "Uninstall failed.";
        }
        finally
        {
            Busy = false;
        }
    }

    private async Task DiagnosticsAsync()
    {
        Busy = true;
        Progress = "Exporting diagnostics…";
        try
        {
            var path = await _service.DiagnosticsAsync();
            Progress = $"Diagnostics written to {path}.";
        }
        finally
        {
            Busy = false;
        }
    }

    private void Apply(IReadOnlyList<ChecklistRow> rows)
    {
        foreach (var row in rows)
        {
            Rows.FirstOrDefault(r => r.Id == row.Id)?.Apply(row);
        }
    }

    private static string Summarize(DetectedEnvironment environment)
    {
        var ae = environment.AfterEffects.Count == 0
            ? "After Effects not found"
            : $"After Effects {environment.AfterEffects[0].Year}";
        var claude = environment.ClaudeDesktop is null ? "Claude Desktop not found" : "Claude Desktop found";
        return $"{ae} · {claude}";
    }

    private bool Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return false;
        }

        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
        return true;
    }
}
