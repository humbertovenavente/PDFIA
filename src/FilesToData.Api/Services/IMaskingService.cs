using FilesToData.Shared.Models;

namespace FilesToData.Api.Services;

/// <summary>
/// Interface for sensitive data masking
/// </summary>
public interface IMaskingService
{
    Task<(string MaskedText, Dictionary<string, MaskingInfo> MaskingMap)> MaskTextAsync(string text);
    object UnmaskData(object data, Dictionary<string, MaskingInfo> maskingMap);
}

/// <summary>
/// Information about a masked value
/// </summary>
public class MaskingInfo
{
    public string Original { get; set; } = string.Empty;
    public SensitiveDataType Type { get; set; }
}
