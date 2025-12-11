using System.Text.Json.Serialization;

namespace FilesToData.Shared.Models;

/// <summary>
/// Types of sensitive data
/// </summary>
public enum SensitiveDataType
{
    PERSON,
    COMPANY,
    PHONE,
    EMAIL,
    BANK_ACCOUNT,
    ID_NUMBER,
    ADDRESS,
    CREDIT_CARD
}

/// <summary>
/// Log entry for masked sensitive data
/// </summary>
public class MaskingLog
{
    [JsonPropertyName("id")]
    public Guid Id { get; set; } = Guid.NewGuid();

    [JsonPropertyName("job_id")]
    public Guid JobId { get; set; }

    [JsonPropertyName("token")]
    public string Token { get; set; } = string.Empty;

    [JsonPropertyName("original_value")]
    public string OriginalValue { get; set; } = string.Empty;

    [JsonPropertyName("type")]
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public SensitiveDataType Type { get; set; }

    [JsonPropertyName("created_at")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
