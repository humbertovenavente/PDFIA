namespace FilesToData.Api.Services;

/// <summary>
/// Interface for queue operations
/// </summary>
public interface IQueueService
{
    Task<string> EnqueueAsync(string queueName, object message);
}
