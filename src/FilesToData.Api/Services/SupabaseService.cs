using System.Collections.Concurrent;
using System.Text.Json;
using FilesToData.Shared.Models;
using Microsoft.Extensions.Logging;

namespace FilesToData.Api.Services;

/// <summary>
/// Implementación en memoria de ISupabaseService.
/// No persiste en Postgres real, pero permite probar el flujo completo localmente.
/// </summary>
public class SupabaseService : ISupabaseService
{
    private readonly ILogger<SupabaseService> _logger;

    private static readonly ConcurrentDictionary<Guid, Job> _jobs = new();
    private static readonly ConcurrentDictionary<Guid, object> _results = new();
    private static readonly ConcurrentDictionary<Guid, List<MaskingLog>> _maskingLogs = new();
    private static readonly ConcurrentDictionary<string, byte[]> _files = new();

    public SupabaseService(ILogger<SupabaseService> logger)
    {
        _logger = logger;
    }

    // =========================================================================
    // JOBS (in-memory)
    // =========================================================================

    public Task<Job> CreateJobAsync(Job job)
    {
        _jobs[job.Id] = job;
        _logger.LogInformation("Job {JobId} creado en memoria", job.Id);
        return Task.FromResult(job);
    }

    public Task<Job?> GetJobAsync(Guid jobId)
    {
        _jobs.TryGetValue(jobId, out var job);
        return Task.FromResult<Job?>(job);
    }

    public Task<List<Job>> ListJobsAsync(JobStatus? status = null, JobMode? mode = null, int limit = 50, int offset = 0)
    {
        var query = _jobs.Values.AsQueryable();

        if (status.HasValue)
            query = query.Where(j => j.Status == status.Value);

        if (mode.HasValue)
            query = query.Where(j => j.Mode == mode.Value);

        var list = query
            .OrderByDescending(j => j.CreatedAt)
            .Skip(offset)
            .Take(limit)
            .ToList();

        return Task.FromResult(list);
    }

    public Task UpdateJobStatusAsync(Guid jobId, JobStatus status, string? errorMessage = null)
    {
        if (_jobs.TryGetValue(jobId, out var job))
        {
            job.Status = status;
            job.ErrorMessage = errorMessage;
            job.UpdatedAt = DateTime.UtcNow;
            _jobs[jobId] = job;
        }

        _logger.LogInformation("Job {JobId} actualizado a {Status}", jobId, status);
        return Task.CompletedTask;
    }

    // =========================================================================
    // RESULTS
    // =========================================================================

    public Task<object?> GetResultsAsync(Guid jobId)
    {
        _results.TryGetValue(jobId, out var data);
        return Task.FromResult(data);
    }

    public Task UpsertResultsAsync(Guid jobId, object data)
    {
        _results[jobId] = data;
        _logger.LogInformation("Resultados actualizados para job {JobId}", jobId);
        return Task.CompletedTask;
    }

    // =========================================================================
    // MASKING LOGS
    // =========================================================================

    public Task CreateMaskingLogAsync(MaskingLog log)
    {
        var list = _maskingLogs.GetOrAdd(log.JobId, _ => new List<MaskingLog>());
        list.Add(log);
        _logger.LogInformation("MaskingLog agregado para job {JobId}", log.JobId);
        return Task.CompletedTask;
    }

    public Task<List<MaskingLog>> GetMaskingLogsAsync(Guid jobId)
    {
        if (_maskingLogs.TryGetValue(jobId, out var list))
        {
            return Task.FromResult(list.ToList());
        }

        return Task.FromResult(new List<MaskingLog>());
    }

    // =========================================================================
    // STORAGE
    // =========================================================================

    public Task UploadFileAsync(string filePath, byte[] content)
    {
        _files[filePath] = content;
        _logger.LogInformation("Archivo {Path} almacenado en memoria", filePath);
        return Task.CompletedTask;
    }

    public Task<byte[]> DownloadFileAsync(string filePath)
    {
        if (_files.TryGetValue(filePath, out var content))
        {
            return Task.FromResult(content);
        }

        throw new FileNotFoundException("File not found in in-memory storage", filePath);
    }

    public Task<string> GetFileUrlAsync(string filePath, int expiresIn = 3600)
    {
        // En modo memoria devolvemos solo la ruta
        return Task.FromResult($"memory://{filePath}");
    }
}
