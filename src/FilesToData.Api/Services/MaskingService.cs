using System.Text.Json;
using System.Text.RegularExpressions;
using FilesToData.Shared.Models;
using Microsoft.Extensions.Logging;

namespace FilesToData.Api.Services;

/// <summary>
/// Service for detecting and masking sensitive data before sending to AI
/// IMPORTANT: No sensitive data should be sent to AI without masking
/// </summary>
public class MaskingService : IMaskingService
{
    private readonly ILogger<MaskingService> _logger;
    private readonly Dictionary<SensitiveDataType, Regex> _patterns;
    private Dictionary<SensitiveDataType, int> _counters = new();

    public MaskingService(ILogger<MaskingService> logger)
    {
        _logger = logger;
        _patterns = CompilePatterns();
    }

    private static Dictionary<SensitiveDataType, Regex> CompilePatterns()
    {
        return new Dictionary<SensitiveDataType, Regex>
        {
            // Email addresses
            [SensitiveDataType.EMAIL] = new Regex(
                @"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b",
                RegexOptions.IgnoreCase | RegexOptions.Compiled),

            // Phone numbers (various formats)
            [SensitiveDataType.PHONE] = new Regex(
                @"(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}",
                RegexOptions.Compiled),

            // Credit card numbers
            [SensitiveDataType.CREDIT_CARD] = new Regex(
                @"\b(?:\d{4}[-\s]?){3}\d{4}\b",
                RegexOptions.Compiled),

            // Bank account numbers (generic pattern)
            [SensitiveDataType.BANK_ACCOUNT] = new Regex(
                @"\b(?:cuenta|account|iban|clabe)[\s:]*[\d\s-]{10,30}\b",
                RegexOptions.IgnoreCase | RegexOptions.Compiled),

            // ID numbers (RFC, CURP, SSN, etc.)
            [SensitiveDataType.ID_NUMBER] = new Regex(
                @"\b(?:RFC|CURP|SSN|DNI|NIF|NIE)[\s:]*[A-Z0-9]{8,18}\b",
                RegexOptions.IgnoreCase | RegexOptions.Compiled),
        };
    }

    private string GetNextToken(SensitiveDataType type)
    {
        if (!_counters.ContainsKey(type))
            _counters[type] = 0;

        _counters[type]++;
        return $"[{type}_{_counters[type]}]";
    }

    public Task<(string MaskedText, Dictionary<string, MaskingInfo> MaskingMap)> MaskTextAsync(string text)
    {
        _counters.Clear();
        var entities = new List<MaskedEntity>();

        // Detect using regex patterns
        foreach (var (type, pattern) in _patterns)
        {
            foreach (Match match in pattern.Matches(text))
            {
                entities.Add(new MaskedEntity
                {
                    Original = match.Value,
                    Token = GetNextToken(type),
                    Type = type,
                    Start = match.Index,
                    End = match.Index + match.Length
                });
            }
        }

        // Detect names and companies
        entities.AddRange(DetectNamesAndCompanies(text));

        // Sort by position (descending) to replace from end to start
        entities = entities.OrderByDescending(e => e.Start).ToList();

        // Remove overlapping entities (keep longer ones)
        var filtered = new List<MaskedEntity>();
        foreach (var entity in entities)
        {
            var overlaps = filtered.Any(e => entity.Start < e.End && entity.End > e.Start);
            if (!overlaps)
                filtered.Add(entity);
        }

        // Apply masking
        var maskedText = text;
        var maskingMap = new Dictionary<string, MaskingInfo>();

        foreach (var entity in filtered)
        {
            maskedText = maskedText.Substring(0, entity.Start) +
                         entity.Token +
                         maskedText.Substring(entity.End);

            maskingMap[entity.Token] = new MaskingInfo
            {
                Original = entity.Original,
                Type = entity.Type
            };
        }

        _logger.LogInformation("Masked {Count} sensitive values", maskingMap.Count);

        return Task.FromResult((maskedText, maskingMap));
    }

    private List<MaskedEntity> DetectNamesAndCompanies(string text)
    {
        var entities = new List<MaskedEntity>();

        // Company patterns
        var companyPatterns = new[]
        {
            @"\b[A-Z][a-záéíóúñ]+(?:\s+[A-Z][a-záéíóúñ]+)*\s+(?:S\.?A\.?(?:\s*de\s*C\.?V\.?)?)\b",
            @"\b[A-Z][a-záéíóúñ]+(?:\s+[A-Z][a-záéíóúñ]+)*\s+(?:S\.?\s*de\s*R\.?L\.?(?:\s*de\s*C\.?V\.?)?)\b",
            @"\b[A-Z][a-záéíóúñ]+(?:\s+[A-Z][a-záéíóúñ]+)*\s+(?:Inc\.?|LLC|Ltd\.?|Corp\.?|GmbH)\b"
        };

        foreach (var pattern in companyPatterns)
        {
            var regex = new Regex(pattern, RegexOptions.Compiled);
            foreach (Match match in regex.Matches(text))
            {
                entities.Add(new MaskedEntity
                {
                    Original = match.Value,
                    Token = GetNextToken(SensitiveDataType.COMPANY),
                    Type = SensitiveDataType.COMPANY,
                    Start = match.Index,
                    End = match.Index + match.Length
                });
            }
        }

        // Person names (2-4 capitalized words)
        var namePattern = new Regex(
            @"\b([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){1,3})\b",
            RegexOptions.Compiled);

        var excludeWords = new HashSet<string>
        {
            "Factura", "Invoice", "Total", "Subtotal", "Cliente", "Customer",
            "Proveedor", "Supplier", "Fecha", "Date", "Número", "Number",
            "Orden", "Order", "Compra", "Purchase", "Venta", "Sale",
            "Descripción", "Description", "Cantidad", "Quantity", "Precio", "Price"
        };

        foreach (Match match in namePattern.Matches(text))
        {
            var name = match.Groups[1].Value;
            var words = name.Split(' ');

            if (words.Any(w => excludeWords.Contains(w)))
                continue;

            if (name.Length < 5 || name.Length > 50)
                continue;

            entities.Add(new MaskedEntity
            {
                Original = name,
                Token = GetNextToken(SensitiveDataType.PERSON),
                Type = SensitiveDataType.PERSON,
                Start = match.Index,
                End = match.Index + match.Length
            });
        }

        return entities;
    }

    public object UnmaskData(object data, Dictionary<string, MaskingInfo> maskingMap)
    {
        var json = JsonSerializer.Serialize(data);

        foreach (var (token, info) in maskingMap)
        {
            json = json.Replace(token, info.Original);
        }

        return JsonSerializer.Deserialize<object>(json) ?? data;
    }

    private class MaskedEntity
    {
        public string Original { get; set; } = string.Empty;
        public string Token { get; set; } = string.Empty;
        public SensitiveDataType Type { get; set; }
        public int Start { get; set; }
        public int End { get; set; }
    }
}
