using System.Text.Json.Serialization;

namespace FilesToData.Shared.Models;

/// <summary>
/// Processing modes for jobs
/// </summary>
public enum JobMode
{
    DOCUMENT,
    DESIGN
}

/// <summary>
/// Job processing status
/// </summary>
public enum JobStatus
{
    PENDING,
    PROCESSING,
    COMPLETED,
    FAILED
}

/// <summary>
/// Represents a processing job
/// </summary>
public class Job
{
    [JsonPropertyName("id")]
    public Guid Id { get; set; } = Guid.NewGuid();

    [JsonPropertyName("mode")]
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public JobMode Mode { get; set; } = JobMode.DOCUMENT;

    [JsonPropertyName("file_path")]
    public string FilePath { get; set; } = string.Empty;

    [JsonPropertyName("file_name")]
    public string? FileName { get; set; }

    [JsonPropertyName("status")]
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public JobStatus Status { get; set; } = JobStatus.PENDING;

    [JsonPropertyName("error_message")]
    public string? ErrorMessage { get; set; }

    [JsonPropertyName("created_at")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    [JsonPropertyName("updated_at")]
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    [JsonPropertyName("results")]
    public object? Results { get; set; }
}

/// <summary>
/// Request to create a new job
/// </summary>
public class CreateJobRequest
{
    [JsonPropertyName("mode")]
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public JobMode Mode { get; set; } = JobMode.DOCUMENT;
}

/// <summary>
/// Response for job creation
/// </summary>
public class CreateJobResponse
{
    [JsonPropertyName("job_id")]
    public Guid JobId { get; set; }

    [JsonPropertyName("mode")]
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public JobMode Mode { get; set; }

    [JsonPropertyName("status")]
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public JobStatus Status { get; set; }

    [JsonPropertyName("file_name")]
    public string? FileName { get; set; }

    [JsonPropertyName("created_at")]
    public DateTime CreatedAt { get; set; }
}

/// <summary>
/// Response for job list
/// </summary>
public class JobListResponse
{
    [JsonPropertyName("jobs")]
    public List<Job> Jobs { get; set; } = new();

    [JsonPropertyName("count")]
    public int Count { get; set; }
}

/// <summary>
/// Request to update job results
/// </summary>
public class UpdateResultsRequest
{
    [JsonPropertyName("data")]
    public object Data { get; set; } = new { };
}
