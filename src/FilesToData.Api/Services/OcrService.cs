using System.Text;
using System.Text.Json;
using UglyToad.PdfPig;
using Microsoft.Extensions.Logging;

namespace FilesToData.Api.Services;

/// <summary>
/// Service for extracting text from documents using OCR
/// Supports Deepseek-OCR and other OCR backends
/// </summary>
public class OcrService : IOcrService
{
    private readonly ILogger<OcrService> _logger;
    private readonly HttpClient _httpClient;
    private readonly string? _deepseekApiKey;
    private readonly string _deepseekEndpoint;

    public OcrService(ILogger<OcrService> logger, IHttpClientFactory httpClientFactory)
    {
        _logger = logger;
        _httpClient = httpClientFactory.CreateClient();
        _deepseekApiKey = Environment.GetEnvironmentVariable("DEEPSEEK_OCR_API_KEY")?.Trim();
        _deepseekEndpoint = (Environment.GetEnvironmentVariable("DEEPSEEK_OCR_ENDPOINT")?.Trim())
            ?? "https://api.deepseek.com/v1/ocr";
    }

    public async Task<string> ExtractTextAsync(byte[] fileContent, string fileName)
    {
        var extension = Path.GetExtension(fileName).ToLowerInvariant().TrimStart('.');

        if (extension == "pdf")
        {
            return await ExtractFromPdfAsync(fileContent);
        }
        else if (IsImageExtension(extension))
        {
            return await ExtractFromImageAsync(fileContent);
        }
        else
        {
            // Try as image by default
            return await ExtractFromImageAsync(fileContent);
        }
    }

    private static bool IsImageExtension(string ext)
    {
        return ext is "jpg" or "jpeg" or "png" or "gif" or "bmp" or "tiff" or "webp";
    }

    private async Task<string> ExtractFromPdfAsync(byte[] pdfContent)
    {
        try
        {
            var localText = TryExtractPdfTextLayer(pdfContent);
            if (!string.IsNullOrWhiteSpace(localText))
            {
                _logger.LogInformation("Extracted text from PDF locally (PdfPig)");
                return localText;
            }

            _logger.LogInformation("PDF has no extractable text layer; falling back to OCR");

            if (!string.IsNullOrEmpty(_deepseekApiKey))
            {
                return await CallDeepseekOcrAsync(pdfContent, "application/pdf");
            }

            // Fallback: return placeholder (in production, use a local OCR library)
            _logger.LogWarning("No OCR API configured, returning placeholder");
            return "[PDF contains no extractable text layer. Configure DEEPSEEK_OCR_API_KEY (or Azure Document Intelligence) for OCR.]";
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error extracting text from PDF");
            throw;
        }
    }

    private string? TryExtractPdfTextLayer(byte[] pdfContent)
    {
        try
        {
            using var ms = new MemoryStream(pdfContent);
            using var document = PdfDocument.Open(ms);

            var sb = new StringBuilder();
            foreach (var page in document.GetPages())
            {
                sb.AppendLine($"--- PAGE {page.Number} ---");
                var text = page.Text;
                if (!string.IsNullOrWhiteSpace(text))
                {
                    sb.AppendLine(text);
                }
                sb.AppendLine();
            }

            var result = sb.ToString().Trim();
            return string.IsNullOrWhiteSpace(result) ? null : result;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "PdfPig failed to extract text from PDF. Will use OCR fallback.");
            return null;
        }
    }

    private async Task<string> ExtractFromImageAsync(byte[] imageContent)
    {
        try
        {
            if (!string.IsNullOrEmpty(_deepseekApiKey))
            {
                return await CallDeepseekOcrAsync(imageContent, "image/png");
            }

            _logger.LogWarning("No OCR API configured, returning placeholder");
            return "[OCR extraction requires DEEPSEEK_OCR_API_KEY configuration]";
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error extracting text from image");
            throw;
        }
    }

    private async Task<string> CallDeepseekOcrAsync(byte[] content, string contentType)
    {
        try
        {
            var base64Content = Convert.ToBase64String(content);

            var request = new HttpRequestMessage(HttpMethod.Post, _deepseekEndpoint);
            request.Headers.Add("Authorization", $"Bearer {_deepseekApiKey}");

            var payload = new
            {
                file = base64Content,
                content_type = contentType,
                language = "auto",
                output_format = "text"
            };

            request.Content = new StringContent(
                JsonSerializer.Serialize(payload),
                Encoding.UTF8,
                "application/json");

            var response = await _httpClient.SendAsync(request);

            // Si la API de Deepseek devuelve error (401 u otro), no rompemos el flujo
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("Deepseek OCR API returned status {StatusCode}. Using placeholder text.", response.StatusCode);
                return "[OCR error or unauthorized - using placeholder text]";
            }

            var responseJson = await response.Content.ReadAsStringAsync();
            var result = JsonSerializer.Deserialize<OcrResponse>(responseJson);

            return result?.Text ?? string.Empty;
        }
        catch (HttpRequestException ex)
        {
            _logger.LogError(ex, "Deepseek OCR API error (network)");
            return "[OCR API network error - using placeholder text]";
        }
    }

    private class OcrResponse
    {
        public string? Text { get; set; }
    }
}
