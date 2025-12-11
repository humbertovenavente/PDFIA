using FilesToData.Shared.Models;

namespace FilesToData.Api.Services;

/// <summary>
/// Interface for Supabase operations
/// </summary>
public interface ISupabaseService
{
    // Jobs
    Task<Job> CreateJobAsync(Job job);
    Task<Job?> GetJobAsync(Guid jobId);
    Task<List<Job>> ListJobsAsync(JobStatus? status = null, JobMode? mode = null, int limit = 50, int offset = 0);
    Task UpdateJobStatusAsync(Guid jobId, JobStatus status, string? errorMessage = null);

    // Results
    Task<object?> GetResultsAsync(Guid jobId);
    Task UpsertResultsAsync(Guid jobId, object data);

    // Masking Logs
    Task CreateMaskingLogAsync(MaskingLog log);
    Task<List<MaskingLog>> GetMaskingLogsAsync(Guid jobId);

    // Storage
    Task UploadFileAsync(string filePath, byte[] content);
    Task<byte[]> DownloadFileAsync(string filePath);
    Task<string> GetFileUrlAsync(string filePath, int expiresIn = 3600);
}
