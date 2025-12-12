using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;
using FilesToData.Api.Services;
using FilesToData.Shared.Models;

namespace FilesToData.Api.Functions;

/// <summary>
/// Queue Trigger Functions for async processing
/// </summary>
public class QueueFunctions
{
    private readonly ILogger<QueueFunctions> _logger;
    private readonly ISupabaseService _supabase;
    private readonly IOcrService _ocrService;
    private readonly IMaskingService _maskingService;
    private readonly IAiService _aiService;

    public QueueFunctions(
        ILogger<QueueFunctions> logger,
        ISupabaseService supabase,
        IOcrService ocrService,
        IMaskingService maskingService,
        IAiService aiService)
    {
        _logger = logger;
        _supabase = supabase;
        _ocrService = ocrService;
        _maskingService = maskingService;
        _aiService = aiService;
    }

    /// <summary>
    /// Process DOCUMENT mode jobs
    /// </summary>
    [Function("ProcessDocumentJob")]
    public async Task ProcessDocumentJob(
        [QueueTrigger("document-jobs", Connection = "AzureWebJobsStorage")] string message)
    {
        _logger.LogInformation("Processing document job: {Message}", message);

        Guid jobId = Guid.Empty;

        try
        {
            var data = JsonSerializer.Deserialize<QueueMessage>(message);
            jobId = data?.JobId ?? throw new Exception("Invalid message format");

            // Update status to PROCESSING
            await _supabase.UpdateJobStatusAsync(jobId, JobStatus.PROCESSING);

            // Get job details
            var job = await _supabase.GetJobAsync(jobId);
            if (job == null)
            {
                // Esto suele ocurrir si el host se reinició y estamos usando
                // SupabaseService en memoria: el mensaje sigue en la cola
                // pero el registro del job ya no existe.
                _logger.LogWarning("Job {JobId} not found in SupabaseService. Skipping message.", jobId);
                return;
            }

            // Download file from storage
            var fileContent = await _supabase.DownloadFileAsync(job.FilePath);

            // Apply OCR to extract text
            var extractedText = await _ocrService.ExtractTextAsync(fileContent, job.FileName ?? "document.pdf");
            _logger.LogInformation("Extracted {Length} characters from document", extractedText.Length);

            // Mask sensitive data
            var (maskedText, maskingMap) = await _maskingService.MaskTextAsync(extractedText);

            // Save masking logs
            foreach (var (token, info) in maskingMap)
            {
                await _supabase.CreateMaskingLogAsync(new MaskingLog
                {
                    JobId = jobId,
                    Token = token,
                    OriginalValue = info.Original,
                    Type = info.Type
                });
            }

            _logger.LogInformation("Masked {Count} sensitive values", maskingMap.Count);

            // Call AI service with masked text
            var structuredData = await _aiService.ExtractDocumentDataAsync(maskedText);

            // Unmask the results
            var unmaskedData = _maskingService.UnmaskData(structuredData, maskingMap);

            // Save results
            await _supabase.UpsertResultsAsync(jobId, unmaskedData);

            // Update status to COMPLETED
            await _supabase.UpdateJobStatusAsync(jobId, JobStatus.COMPLETED);

            _logger.LogInformation("Successfully completed document processing for job {JobId}", jobId);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error processing document job");

            if (jobId != Guid.Empty)
            {
                await _supabase.UpdateJobStatusAsync(jobId, JobStatus.FAILED, ex.Message);
            }

            return;
        }
    }

    /// <summary>
    /// Process DESIGN mode jobs
    /// </summary>
    [Function("ProcessDesignJob")]
    public async Task ProcessDesignJob(
        [QueueTrigger("design-jobs", Connection = "AzureWebJobsStorage")] string message)
    {
        _logger.LogInformation("Processing design job: {Message}", message);

        Guid jobId = Guid.Empty;

        try
        {
            var data = JsonSerializer.Deserialize<QueueMessage>(message);
            jobId = data?.JobId ?? throw new Exception("Invalid message format");

            // Update status to PROCESSING
            await _supabase.UpdateJobStatusAsync(jobId, JobStatus.PROCESSING);

            // Get job details
            var job = await _supabase.GetJobAsync(jobId);
            if (job == null)
            {
                _logger.LogWarning("Job {JobId} not found in SupabaseService. Skipping message.", jobId);
                return;
            }

            // Download image from storage
            var imageContent = await _supabase.DownloadFileAsync(job.FilePath);

            // Call AI vision service
            var designAnalysis = await _aiService.AnalyzeDesignImageAsync(
                imageContent,
                job.FileName ?? "image.png"
            );

            _logger.LogInformation("Design analysis completed for job {JobId}", jobId);

            // Save results
            await _supabase.UpsertResultsAsync(jobId, designAnalysis);

            // Update status to COMPLETED
            await _supabase.UpdateJobStatusAsync(jobId, JobStatus.COMPLETED);

            _logger.LogInformation("Successfully completed design processing for job {JobId}", jobId);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error processing design job");

            if (jobId != Guid.Empty)
            {
                await _supabase.UpdateJobStatusAsync(jobId, JobStatus.FAILED, ex.Message);
            }

            return;
        }
    }

    private class QueueMessage
    {
        [JsonPropertyName("job_id")]
        public Guid JobId { get; set; }
    }
}
