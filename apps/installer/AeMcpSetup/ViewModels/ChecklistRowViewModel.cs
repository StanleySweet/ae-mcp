using System.ComponentModel;
using System.Runtime.CompilerServices;
using AeMcpSetup.Core;
using Avalonia.Media;

namespace AeMcpSetup.ViewModels;

/// <summary>One checklist row: a label plus a status pill and an optional hint.</summary>
public sealed class ChecklistRowViewModel : INotifyPropertyChanged
{
    private string _status = Checklist.Pending;
    private string? _fix;

    public ChecklistRowViewModel(string id, string label)
    {
        Id = id;
        Label = label;
    }

    public string Id { get; }

    public string Label { get; }

    public event PropertyChangedEventHandler? PropertyChanged;

    public string Status
    {
        get => _status;
        private set
        {
            if (_status == value)
            {
                return;
            }

            _status = value;
            Raise(nameof(Status));
            Raise(nameof(StatusText));
            Raise(nameof(StatusBrush));
        }
    }

    public string? Fix
    {
        get => _fix;
        private set
        {
            if (_fix == value)
            {
                return;
            }

            _fix = value;
            Raise(nameof(Fix));
            Raise(nameof(HasFix));
        }
    }

    public bool HasFix => !string.IsNullOrEmpty(_fix);

    public string StatusText => _status switch
    {
        Checklist.Ok => "OK",
        Checklist.Fail => "Fix",
        _ => "—",
    };

    public IBrush StatusBrush => new SolidColorBrush(Color.Parse(_status switch
    {
        Checklist.Ok => "#2E7D32",
        Checklist.Fail => "#C62828",
        _ => "#757575",
    }));

    public void Apply(ChecklistRow row)
    {
        Status = row.Status;
        Fix = row.Fix;
    }

    private void Raise([CallerMemberName] string? name = null)
        => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
