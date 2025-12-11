using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using FilesToData.Api.Services;

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
    })
    .Build();

host.Run();
