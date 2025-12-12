using System.IO;
using System.Text;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using FilesToData.Api.Services;

DotEnv.Load();

var host = new HostBuilder()
    .ConfigureFunctionsWorkerDefaults()
    .ConfigureServices(services =>
    {
        services.AddApplicationInsightsTelemetryWorkerService();
        services.ConfigureFunctionsApplicationInsights();
        
        // Register services
        services.AddSingleton<ISupabaseService, SupabaseService>();
        services.AddSingleton<IMaskingService, MaskingService>();
        services.AddSingleton<IOcrService, OcrService>();
        services.AddSingleton<IAiService, AiService>();
        services.AddSingleton<IQueueService, QueueService>();
        
        // Add HttpClient
        services.AddHttpClient();
        var timeoutSeconds = int.TryParse(Environment.GetEnvironmentVariable("CLAUDE_TIMEOUT_SECONDS")?.Trim(), out var ts) ? ts : 300;
        services.AddHttpClient("Claude", client =>
        {
            client.Timeout = TimeSpan.FromSeconds(timeoutSeconds);
        });
    })
    .Build();

host.Run();

static class DotEnv
{
    public static void Load(string fileName = ".env")
    {
        try
        {
            var path = FindFileUpwards(Directory.GetCurrentDirectory(), fileName);
            if (path == null || !File.Exists(path))
                return;

            foreach (var rawLine in File.ReadAllLines(path, Encoding.UTF8))
            {
                var line = rawLine.Trim();
                if (line.Length == 0) continue;
                if (line.StartsWith("#", StringComparison.Ordinal)) continue;

                var idx = line.IndexOf('=');
                if (idx <= 0) continue;

                var key = line.Substring(0, idx).Trim();
                var value = line.Substring(idx + 1).Trim();

                if ((value.StartsWith('"') && value.EndsWith('"')) || (value.StartsWith('\'') && value.EndsWith('\'')))
                    value = value.Substring(1, value.Length - 2);

                if (key.Length == 0) continue;
                Environment.SetEnvironmentVariable(key, value);
            }
        }
        catch
        {
            // Intentionally swallow errors for local convenience
        }
    }

    private static string? FindFileUpwards(string startDirectory, string fileName)
    {
        var dir = new DirectoryInfo(startDirectory);
        while (dir != null)
        {
            var candidate = Path.Combine(dir.FullName, fileName);
            if (File.Exists(candidate))
                return candidate;

            dir = dir.Parent;
        }

        return null;
    }
}
