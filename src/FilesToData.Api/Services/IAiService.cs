namespace FilesToData.Api.Services;

/// <summary>
/// Interface for AI model interactions
/// </summary>
public interface IAiService
{
    Task<object> ExtractDocumentDataAsync(string maskedText);
    Task<object> AnalyzeDesignImageAsync(byte[] imageContent, string fileName);
}
