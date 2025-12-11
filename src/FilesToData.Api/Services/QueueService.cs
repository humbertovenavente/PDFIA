using System.Text;
using System.Text.Json;
using Azure.Storage.Queues;
using Microsoft.Extensions.Logging;

namespace FilesToData.Api.Services;

/// <summary>
/// Service for Azure Queue Storage operations
/// </summary>
public class QueueService : IQueueService
{
    private readonly ILogger<QueueService> _logger;
    private readonly string _connectionString;

    public QueueService(ILogger<QueueService> logger)
    {
        _logger = logger;

        // Usar la misma conexión que las Functions (AzureWebJobsStorage)
        // y dejar QUEUE_CONNECTION_STRING solo como fallback.
        _connectionString =
            Environment.GetEnvironmentVariable("AzureWebJobsStorage")
            ?? Environment.GetEnvironmentVariable("QUEUE_CONNECTION_STRING")
            ?? "UseDevelopmentStorage=true";
    }

    public async Task<string> EnqueueAsync(string queueName, object message)
    {
        try
        {
            var queueClient = new QueueClient(_connectionString, queueName);
            await queueClient.CreateIfNotExistsAsync();

            var messageJson = JsonSerializer.Serialize(message);
            var messageBytes = Encoding.UTF8.GetBytes(messageJson);
            var base64Message = Convert.ToBase64String(messageBytes);

            var response = await queueClient.SendMessageAsync(base64Message);

            _logger.LogInformation("Enqueued message to {QueueName}: {Message}", queueName, messageJson);

            return response.Value.MessageId;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error enqueueing message to {QueueName}", queueName);
            throw;
        }
    }
}
