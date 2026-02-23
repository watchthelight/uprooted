namespace Uprooted;

internal static class PlatformPaths
{
    internal static string GetProfileDir()
    {
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        return Path.Combine(localAppData, "Root Communications", "Root", "profile", "default");
    }

    /// <summary>
    /// Returns the deployed Uprooted assets directory.
    /// Windows: %LOCALAPPDATA%\Root\uprooted\
    /// Linux:   ~/.local/share/uprooted/
    /// </summary>
    internal static string GetUprootedDir()
    {
        if (OperatingSystem.IsWindows())
        {
            var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            return Path.Combine(localAppData, "Root", "uprooted");
        }
        else
        {
            var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            return Path.Combine(home, ".local", "share", "uprooted");
        }
    }
}
