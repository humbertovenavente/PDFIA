using System.Net;
using System.Text.Json;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;
using FilesToData.Api.Services;
using FilesToData.Shared.Models;

namespace FilesToData.Api.Functions;

/// <summary>
/// HTTP Trigger Functions for Job API
/// </summary>
public class JobFunctions
{
    private readonly ILogger<JobFunctions> _logger;
    private readonly ISupabaseService _supabase;
    private readonly IQueueService _queueService;

    public JobFunctions(
        ILogger<JobFunctions> logger,
        ISupabaseService supabase,
        IQueueService queueService)
    {
        _logger = logger;
        _supabase = supabase;
        _queueService = queueService;
    }

    /// <summary>
    /// POST /api/jobs - Create a new processing job
    /// </summary>
    [Function("CreateJob")]
    public async Task<HttpResponseData> CreateJob(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "jobs")] HttpRequestData req)
    {
        _logger.LogInformation("Creating new job");

        try
        {
            // Parse mode from query string
            var query = System.Web.HttpUtility.ParseQueryString(req.Url.Query);
            var modeStr = query["mode"] ?? "DOCUMENT";
            
            if (!Enum.TryParse<JobMode>(modeStr, true, out var mode))
            {
                var badRequest = req.CreateResponse(HttpStatusCode.BadRequest);
                await badRequest.WriteAsJsonAsync(new { error = "Invalid mode. Must be 'DOCUMENT' or 'DESIGN'" });
                return badRequest;
            }

            // Parse multipart form data
            var formData = await ParseMultipartFormData(req);
            if (formData.FileContent == null || string.IsNullOrEmpty(formData.FileName))
            {
                var badRequest = req.CreateResponse(HttpStatusCode.BadRequest);
                await badRequest.WriteAsJsonAsync(new { error = "No file provided" });
                return badRequest;
            }

            // Create job
            var jobId = Guid.NewGuid();
            var filePath = $"uploads/{jobId}/{formData.FileName}";

            // Upload file to storage
            await _supabase.UploadFileAsync(filePath, formData.FileContent);

            // Create job record
            var job = new Job
            {
                Id = jobId,
                Mode = mode,
                FilePath = filePath,
                FileName = formData.FileName,
                Status = JobStatus.PENDING,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            };

            await _supabase.CreateJobAsync(job);

            // Enqueue for processing
            var queueName = mode == JobMode.DOCUMENT ? "document-jobs" : "design-jobs";
            await _queueService.EnqueueAsync(queueName, new { job_id = jobId });

            _logger.LogInformation("Created job {JobId} with mode {Mode}", jobId, mode);

            var response = req.CreateResponse(HttpStatusCode.Created);
            await response.WriteAsJsonAsync(new CreateJobResponse
            {
                JobId = jobId,
                Mode = mode,
                Status = JobStatus.PENDING,
                FileName = formData.FileName,
                CreatedAt = job.CreatedAt
            });

            return response;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error creating job");
            var error = req.CreateResponse(HttpStatusCode.InternalServerError);
            await error.WriteAsJsonAsync(new { error = ex.Message });
            return error;
        }
    }

    /// <summary>
    /// GET /api/jobs - List all jobs
    /// </summary>
    [Function("ListJobs")]
    public async Task<HttpResponseData> ListJobs(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "jobs")] HttpRequestData req)
    {
        try
        {
            var query = System.Web.HttpUtility.ParseQueryString(req.Url.Query);
            var status = query["status"];
            var mode = query["mode"];
            var limit = int.TryParse(query["limit"], out var l) ? l : 50;
            var offset = int.TryParse(query["offset"], out var o) ? o : 0;

            JobStatus? statusFilter = null;
            if (!string.IsNullOrEmpty(status) && Enum.TryParse<JobStatus>(status, true, out var s))
                statusFilter = s;

            JobMode? modeFilter = null;
            if (!string.IsNullOrEmpty(mode) && Enum.TryParse<JobMode>(mode, true, out var m))
                modeFilter = m;

            var jobs = await _supabase.ListJobsAsync(statusFilter, modeFilter, limit, offset);

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(new JobListResponse
            {
                Jobs = jobs,
                Count = jobs.Count
            });

            return response;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error listing jobs");
            var error = req.CreateResponse(HttpStatusCode.InternalServerError);
            await error.WriteAsJsonAsync(new { error = ex.Message });
            return error;
        }
    }

    /// <summary>
    /// GET /api/jobs/{jobId} - Get job details
    /// </summary>
    [Function("GetJob")]
    public async Task<HttpResponseData> GetJob(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "jobs/{jobId}")] HttpRequestData req,
        string jobId)
    {
        try
        {
            if (!Guid.TryParse(jobId, out var id))
            {
                var badRequest = req.CreateResponse(HttpStatusCode.BadRequest);
                await badRequest.WriteAsJsonAsync(new { error = "Invalid job ID" });
                return badRequest;
            }

            var job = await _supabase.GetJobAsync(id);
            if (job == null)
            {
                var notFound = req.CreateResponse(HttpStatusCode.NotFound);
                await notFound.WriteAsJsonAsync(new { error = "Job not found" });
                return notFound;
            }

            // Get results if available
            var results = await _supabase.GetResultsAsync(id);
            job.Results = results;

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(job);
            return response;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error getting job {JobId}", jobId);
            var error = req.CreateResponse(HttpStatusCode.InternalServerError);
            await error.WriteAsJsonAsync(new { error = ex.Message });
            return error;
        }
    }

    /// <summary>
    /// PUT /api/jobs/{jobId}/results - Update job results
    /// </summary>
    [Function("UpdateJobResults")]
    public async Task<HttpResponseData> UpdateJobResults(
        [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "jobs/{jobId}/results")] HttpRequestData req,
        string jobId)
    {
        try
        {
            if (!Guid.TryParse(jobId, out var id))
            {
                var badRequest = req.CreateResponse(HttpStatusCode.BadRequest);
                await badRequest.WriteAsJsonAsync(new { error = "Invalid job ID" });
                return badRequest;
            }

            var body = await req.ReadAsStringAsync();
            var request = JsonSerializer.Deserialize<UpdateResultsRequest>(body ?? "{}");

            if (request?.Data == null)
            {
                var badRequest = req.CreateResponse(HttpStatusCode.BadRequest);
                await badRequest.WriteAsJsonAsync(new { error = "'data' field is required" });
                return badRequest;
            }

            var job = await _supabase.GetJobAsync(id);
            if (job == null)
            {
                var notFound = req.CreateResponse(HttpStatusCode.NotFound);
                await notFound.WriteAsJsonAsync(new { error = "Job not found" });
                return notFound;
            }

            await _supabase.UpsertResultsAsync(id, request.Data);

            _logger.LogInformation("Updated results for job {JobId}", id);

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(new { message = "Results updated successfully", job_id = id });
            return response;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error updating job results {JobId}", jobId);
            var error = req.CreateResponse(HttpStatusCode.InternalServerError);
            await error.WriteAsJsonAsync(new { error = ex.Message });
            return error;
        }
    }

    /// <summary>
    /// GET /api/health - Health check
    /// </summary>
    [Function("HealthCheck")]
    public HttpResponseData HealthCheck(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "health")] HttpRequestData req)
    {
        var response = req.CreateResponse(HttpStatusCode.OK);
        response.WriteAsJsonAsync(new { status = "healthy", version = "2.7.0" });
        return response;
    }

    private async Task<(byte[]? FileContent, string? FileName)> ParseMultipartFormData(HttpRequestData req)
    {
        // Simplified multipart parsing - in production use a proper library
        var contentType = req.Headers.TryGetValues("Content-Type", out var values) 
            ? values.FirstOrDefault() 
            : null;

        if (contentType == null || !contentType.Contains("multipart/form-data"))
        {
            return (null, null);
        }

        // Leer el cuerpo como bytes desde el Stream
        using var ms = new MemoryStream();
        await req.Body.CopyToAsync(ms);
        var body = ms.ToArray();

        // Extract boundary
        var boundaryIndex = contentType.IndexOf("boundary=");
        if (boundaryIndex < 0) return (null, null);
        
        var boundary = contentType.Substring(boundaryIndex + 9).Trim('"');

        var boundaryBytes = System.Text.Encoding.UTF8.GetBytes("--" + boundary);
        var headerSeparatorBytes = System.Text.Encoding.UTF8.GetBytes("\r\n\r\n");

        var idx = 0;
        while (idx >= 0 && idx < body.Length)
        {
            var start = IndexOf(body, boundaryBytes, idx);
            if (start < 0) break;

            start += boundaryBytes.Length;

            if (start + 1 < body.Length && body[start] == (byte)'-' && body[start + 1] == (byte)'-')
                break;

            if (start + 1 < body.Length && body[start] == (byte)'\r' && body[start + 1] == (byte)'\n')
                start += 2;

            var next = IndexOf(body, boundaryBytes, start);
            if (next < 0) break;

            var partLength = next - start;
            if (partLength <= 0)
            {
                idx = next;
                continue;
            }

            var part = new byte[partLength];
            Buffer.BlockCopy(body, start, part, 0, partLength);

            var headerEnd = IndexOf(part, headerSeparatorBytes, 0);
            if (headerEnd < 0)
            {
                idx = next;
                continue;
            }

            var headersText = System.Text.Encoding.UTF8.GetString(part, 0, headerEnd);
            if (!headersText.Contains("filename=", StringComparison.OrdinalIgnoreCase))
            {
                idx = next;
                continue;
            }

            var filenameMatch = System.Text.RegularExpressions.Regex.Match(headersText, @"filename=""([^""]+)""");
            if (!filenameMatch.Success)
            {
                idx = next;
                continue;
            }

            var filename = filenameMatch.Groups[1].Value;

            var contentStart = headerEnd + headerSeparatorBytes.Length;
            var contentEnd = part.Length;

            if (contentEnd >= 2 && part[contentEnd - 2] == (byte)'\r' && part[contentEnd - 1] == (byte)'\n')
                contentEnd -= 2;

            if (contentEnd < contentStart)
            {
                idx = next;
                continue;
            }

            var fileBytes = new byte[contentEnd - contentStart];
            Buffer.BlockCopy(part, contentStart, fileBytes, 0, fileBytes.Length);
            return (fileBytes, filename);
        }

        return (null, null);
    }

    private static int IndexOf(byte[] buffer, byte[] pattern, int startIndex)
    {
        if (pattern.Length == 0) return -1;
        if (startIndex < 0) startIndex = 0;
        if (startIndex >= buffer.Length) return -1;

        for (var i = startIndex; i <= buffer.Length - pattern.Length; i++)
        {
            var match = true;
            for (var j = 0; j < pattern.Length; j++)
            {
                if (buffer[i + j] != pattern[j])
                {
                    match = false;
                    break;
                }
            }

            if (match) return i;
        }

        return -1;
    }
}
