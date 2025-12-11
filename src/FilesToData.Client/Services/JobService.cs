using System.Net.Http.Json;
using FilesToData.Shared.Models;

namespace FilesToData.Client.Services;

/// <summary>
/// Service for job API operations
/// </summary>
public class JobService : IJobService
{
    private readonly HttpClient _httpClient;

    public JobService(HttpClient httpClient)
    {
        _httpClient = httpClient;
    }

    public async Task<CreateJobResponse> CreateJobAsync(byte[] fileContent, string fileName, JobMode mode)
    {
        using var content = new MultipartFormDataContent();
        var fileContentData = new ByteArrayContent(fileContent);
        content.Add(fileContentData, "file", fileName);

        var response = await _httpClient.PostAsync($"jobs?mode={mode}", content);
        response.EnsureSuccessStatusCode();

        return await response.Content.ReadFromJsonAsync<CreateJobResponse>() 
            ?? throw new Exception("Failed to parse response");
    }

    public async Task<JobListResponse> ListJobsAsync(JobStatus? status = null, JobMode? mode = null)
    {
        var query = new List<string>();
        if (status.HasValue) query.Add($"status={status}");
        if (mode.HasValue) query.Add($"mode={mode}");

        var url = "jobs" + (query.Any() ? "?" + string.Join("&", query) : "");

        return await _httpClient.GetFromJsonAsync<JobListResponse>(url) 
            ?? new JobListResponse();
    }

    public async Task<Job?> GetJobAsync(Guid jobId)
    {
        return await _httpClient.GetFromJsonAsync<Job>($"jobs/{jobId}");
    }

    public async Task UpdateResultsAsync(Guid jobId, object data)
    {
        var request = new UpdateResultsRequest { Data = data };
        var response = await _httpClient.PutAsJsonAsync($"jobs/{jobId}/results", request);
        response.EnsureSuccessStatusCode();
    }
}
