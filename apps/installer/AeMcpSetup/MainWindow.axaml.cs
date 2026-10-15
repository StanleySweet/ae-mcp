using AeMcpSetup.ViewModels;
using Avalonia.Controls;

namespace AeMcpSetup;

public partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
        var viewModel = new MainViewModel(new SetupService());
        DataContext = viewModel;
        Opened += async (_, _) => await viewModel.InitializeAsync();
    }
}
