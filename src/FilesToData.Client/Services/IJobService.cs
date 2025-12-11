using FilesToData.Shared.Models;

namespace FilesToData.Client.Services;

/// <summary>
/// Interface for job API operations
/// </summary>
public interface IJobService
{
    Task<CreateJobResponse> CreateJobAsync(byte[] fileContent, string fileName, JobMode mode);
    Task<JobListResponse> ListJobsAsync(JobStatus? status = null, JobMode? mode = null);
    Task<Job?> GetJobAsync(Guid jobId);
    Task UpdateResultsAsync(Guid jobId, object data);
}
