namespace FilesToData.Api.Services;

/// <summary>
/// Interface for OCR text extraction
/// </summary>
public interface IOcrService
{
    Task<string> ExtractTextAsync(byte[] fileContent, string fileName);
}
