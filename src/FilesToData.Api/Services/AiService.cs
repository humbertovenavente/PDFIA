using System.Net.Http.Headers;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging;

namespace FilesToData.Api.Services;

/// <summary>
/// Stub de servicio de IA. No llama a Claude; devuelve estructuras simuladas.
/// Esto permite compilar y probar el flujo end-to-end sin depender de SDKs externos.
/// </summary>
public class AiService : IAiService
{
    private readonly ILogger<AiService> _logger;
    private readonly HttpClient _httpClient;
    private readonly string? _apiKey;
    private readonly string _model;

    public AiService(ILogger<AiService> logger, IHttpClientFactory httpClientFactory)
    {
        _logger = logger;
        _httpClient = httpClientFactory.CreateClient("Claude");
        _apiKey = Environment.GetEnvironmentVariable("CLAUDE_API_KEY")?.Trim();
        _model = NullIfEmpty(Environment.GetEnvironmentVariable("CLAUDE_MODEL")?.Trim()) ?? "claude-3-sonnet-20240229";
    }

    public async Task<object> ExtractDocumentDataAsync(string maskedText)
    {
        if (string.IsNullOrWhiteSpace(_apiKey))
        {
            throw new InvalidOperationException("CLAUDE_API_KEY is not configured");
        }

        var pages = SplitPages(maskedText);
        var pageResults = new List<object>();

        foreach (var page in pages)
        {
            var prompt =
                "You are a JSON extraction service. Return ONLY valid JSON.\n" +
                "This is a SEWING WORKSHEET document. Extract ALL visible data.\n\n" +
                "PARSING INSTRUCTIONS (the OCR text is concatenated without spaces):\n" +
                "- Look for patterns like 'CF911 (254755)61341841/13DUSTY PERIBL7002' which is: style='CF911 (254755)', po='6134184', xfty='1/13', color='DUSTY PERI', color_code='BL7002'\n" +
                "- Numbers after color codes are size quantities: 67,133,290,268,170,133,85,65 then TOTAL=1,211\n" +
                "- 'SUB TOTAL' rows sum quantities per color\n" +
                "- 'GRAND TOTAL' row has final totals: 0,197,388,855,787,501,392,250,193 = 3,563\n" +
                "- Numbered instructions like '1ANTES DE CORTAR...' means instruction 1 is 'ANTES DE CORTAR...'\n" +
                "- Measurement rows: 'Front Body Length from HPS (mid length shirt)1/21516 1/218...' = name, tol=1/2, sizes=15,16 1/2,18...\n\n" +
                "EXTRACT THESE FIELDS:\n" +
                "- order_info: #FILE, CLIENTE/BUYER, STYLE#, PRODUCTO, TEMPORADA, CANTIDAD, ENTREGA, COSTO/CM, TOTAL USD\n" +
                "- fabric_info: HILAZA/YARN, TELA 1/FABRIC, ANCHO/WIDTH, PESO/WEIGHT, TELA 2, CONSUMO/YIELD\n" +
                "- quantity_lines: ALL rows from section 4 (style, PO, XFTY, color, color_code, size quantities, total)\n" +
                "- order_procedure: 'CORTE - COSTURA - EMPAQUE'\n" +
                "- order_procedure_notes: Instructions 1-7 from section 5 (DETALLES DE CORTE)\n" +
                "- sewing_detail_notes: Instructions 1-12 from section 6 (COSTURA/SEWING)\n" +
                "- measurement_rows: ALL rows from section 7 (PUNTOS DE MEDIDA with TOL and size values)\n" +
                "- labels_info: TAMANO DE FOLDING, HANGTAG, PIEZAS EN CAJA\n\n" +
                "JSON schema:\n" +
                "{\n" +
                "  \"template_type\": \"sewing_worksheet\"|\"generic_document\",\n" +
                "  \"sewing_worksheet\": {\n" +
                "    \"header\": {\n" +
                "      \"contact\": string|null,\n" +
                "      \"revised_date\": string|null,\n" +
                "      \"requested_by\": string|null,\n" +
                "      \"requested_by_address\": string|null,\n" +
                "      \"requested_by_phone\": string|null,\n" +
                "      \"work_plant\": string|null,\n" +
                "      \"work_plant_address\": string|null,\n" +
                "      \"document_date\": string|null,\n" +
                "      \"signatures\": {\n" +
                "        \"damdang\": string|null,\n" +
                "        \"daeri\": string|null,\n" +
                "        \"chajang\": string|null,\n" +
                "        \"bujang\": string|null,\n" +
                "        \"sangmu\": string|null,\n" +
                "        \"busajang\": string|null\n" +
                "      }\n" +
                "    },\n" +
                "    \"order_info\": {\n" +
                "      \"file\": string|null,\n" +
                "      \"buyer\": string|null,\n" +
                "      \"style\": string|null,\n" +
                "      \"product\": string|null,\n" +
                "      \"season\": string|null,\n" +
                "      \"qty\": number|null,\n" +
                "      \"ship_date\": string|null,\n" +
                "      \"cm_cost\": number|null,\n" +
                "      \"total_usd\": number|null,\n" +
                "      \"grand_total_usd\": number|null\n" +
                "    },\n" +
                "    \"fabric_info\": {\n" +
                "      \"yarn\": string|null,\n" +
                "      \"fabric\": string|null,\n" +
                "      \"width\": string|null,\n" +
                "      \"weight\": string|null,\n" +
                "      \"fabric2\": string|null,\n" +
                "      \"width2\": string|null,\n" +
                "      \"yield_total\": number|null,\n" +
                "      \"loss_comment\": string|null\n" +
                "    },\n" +
                "    \"quantity_lines\": [\n" +
                "      {\n" +
                "        \"type\": \"Normal\"|\"Subtotal\"|\"GrandTotal\",\n" +
                "        \"style\": string|null,\n" +
                "        \"po\": string|null,\n" +
                "        \"xfty\": string|null,\n" +
                "        \"color_name\": string|null,\n" +
                "        \"color_code\": string|null,\n" +
                "        \"sizes\": {\n" +
                "          \"xxs_2_3\": number|null,\n" +
                "          \"xs_4_5\": number|null,\n" +
                "          \"s_6_7\": number|null,\n" +
                "          \"m_8_9\": number|null,\n" +
                "          \"l_10_11\": number|null,\n" +
                "          \"xl_12_13\": number|null,\n" +
                "          \"xxl_14_15\": number|null,\n" +
                "          \"xxxl_16\": number|null\n" +
                "        },\n" +
                "        \"total\": number|null\n" +
                "      }\n" +
                "    ]|null,\n" +
                "    \"order_procedure\": string|null,\n" +
                "    \"order_procedure_notes\": [string]|null,\n" +
                "    \"cutting_detail_notes\": [string]|null,\n" +
                "    \"sewing_detail_notes\": [string]|null,\n" +
                "    \"trim_packing_notes\": [string]|null,\n" +
                "    \"labels_info\": {\n" +
                "      \"folding_size\": string|null,\n" +
                "      \"hangtag\": string|null,\n" +
                "      \"pieces_per_box\": string|null,\n" +
                "      \"additional_notes\": [string]|null\n" +
                "    },\n" +
                "    \"design_images\": [string]|null,\n" +
                "    \"measurement_rows\": [\n" +
                "      {\n" +
                "        \"name\": string,\n" +
                "        \"tolerance\": string,\n" +
                "        \"xxs_2_3\": string,\n" +
                "        \"xs_4_5\": string,\n" +
                "        \"s_6_7\": string,\n" +
                "        \"m_8_9\": string,\n" +
                "        \"l_10_11\": string,\n" +
                "        \"xl_12_13\": string,\n" +
                "        \"xxl_14_15\": string,\n" +
                "        \"xxxl_16\": string\n" +
                "      }\n" +
                "    ]|null\n" +
                "  }|null,\n" +
                "  \"generic_document\": {\n" +
                "    \"tipo_documento\": string,\n" +
                "    \"numero_documento\": string|null,\n" +
                "    \"fecha_emision\": string|null,\n" +
                "    \"fecha_vencimiento\": string|null,\n" +
                "    \"emisor\": {\"nombre\": string|null, \"rfc\": string|null, \"direccion\": string|null, \"telefono\": string|null, \"email\": string|null},\n" +
                "    \"receptor\": {\"nombre\": string|null, \"rfc\": string|null, \"direccion\": string|null, \"telefono\": string|null, \"email\": string|null},\n" +
                "    \"items\": [{\"descripcion\": string|null, \"cantidad\": number|null, \"unidad\": string|null, \"precio_unitario\": number|null, \"importe\": number|null}],\n" +
                "    \"subtotal\": number|null,\n" +
                "    \"impuestos\": number|null,\n" +
                "    \"total\": number|null,\n" +
                "    \"moneda\": string|null,\n" +
                "    \"notas\": string|null,\n" +
                "    \"metodo_pago\": string|null,\n" +
                "    \"condiciones_pago\": string|null\n" +
                "  }|null\n" +
                "}\n\n" +
                $"PAGE: {page.PageNumber}\n" +
                "OCR TEXT:\n" + page.Text;

            var responseText = await CallClaudeMessagesApiAsync(
                maxTokens: 4096,
                messageContent: new object[]
                {
                    new { type = "text", text = prompt }
                });

            var json = ExtractJsonObject(responseText);
            if (json == null)
                throw new Exception("Claude response did not contain valid JSON");

            json = NormalizeClaudePageJson(json);

            json = await EnrichSewingWorksheetSectionsIfMissingAsync(json, page.Text);

            var parsed = JsonSerializer.Deserialize<object>(json);
            if (parsed == null)
                throw new Exception("Claude JSON could not be parsed");

            pageResults.Add(new
            {
                page_number = page.PageNumber,
                raw_text = page.Text,
                data = parsed
            });
        }

        return new
        {
            pages = pageResults,
            raw_text = maskedText
        };
    }

    private async Task<string> EnrichSewingWorksheetSectionsIfMissingAsync(string normalizedPageJson, string ocrText)
    {
        JsonNode? rootNode;
        try
        {
            rootNode = JsonNode.Parse(normalizedPageJson);
        }
        catch
        {
            return normalizedPageJson;
        }

        if (rootNode is not JsonObject root)
            return normalizedPageJson;

        var templateType = root["template_type"]?.GetValue<string?>();
        if (!string.Equals(templateType, "sewing_worksheet", StringComparison.OrdinalIgnoreCase))
            return normalizedPageJson;

        if (root["sewing_worksheet"] is not JsonObject sw)
            return normalizedPageJson;

        var needsQuantity = IsNullOrMissing(sw["quantity_lines"]);
        var needsMeasurements = IsNullOrMissing(sw["measurement_rows"]);
        var needsOrderProcedure = IsNullOrMissing(sw["order_procedure"]);
        var needsOrderNotes = IsNullOrMissing(sw["order_procedure_notes"]);
        var needsCutNotes = IsNullOrMissing(sw["cutting_detail_notes"]);
        var needsSewNotes = IsNullOrMissing(sw["sewing_detail_notes"]);
        var needsTrimNotes = IsNullOrMissing(sw["trim_packing_notes"]);

        if (!needsQuantity && !needsMeasurements && !needsOrderProcedure && !needsOrderNotes && !needsCutNotes && !needsSewNotes && !needsTrimNotes)
            return normalizedPageJson;

        var tasks = new List<Task<JsonObject?>>();

        if (needsQuantity)
            tasks.Add(ExtractQuantityLinesAsync(ocrText));

        if (needsMeasurements)
            tasks.Add(ExtractMeasurementRowsAsync(ocrText));

        if (needsOrderProcedure || needsOrderNotes || needsCutNotes)
            tasks.Add(ExtractOrderProcedureAndCuttingNotesAsync(ocrText));

        if (needsSewNotes)
            tasks.Add(ExtractSewingNotesAsync(ocrText));

        if (needsTrimNotes)
            tasks.Add(ExtractTrimPackingNotesAsync(ocrText));

        JsonObject?[] results;
        try
        {
            results = await Task.WhenAll(tasks);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Section enrichment failed; returning base JSON.");
            return normalizedPageJson;
        }

        foreach (var patch in results)
        {
            if (patch == null) continue;
            foreach (var kvp in patch)
            {
                if (IsNullOrMissing(kvp.Value))
                    continue;

                if (IsNullOrMissing(sw[kvp.Key]))
                    sw[kvp.Key] = kvp.Value == null ? null : JsonNode.Parse(kvp.Value.ToJsonString());
            }
        }

        return root.ToJsonString();
    }

    private async Task<JsonObject?> ExtractQuantityLinesAsync(string ocrText)
    {
        var snippet = ExtractSnippet(
            ocrText,
            startMarkers: new[] { "4. CANTIDAD", "QTY PER STYLE", "CANTIDAD POR ESTILO", "GRAND TOTAL" },
            endMarkers: new[] { "1ANTES DE CORTAR", "5.  DETALLES", "PUNTOS DE MEDIDA", "Page" },
            fallbackMaxChars: 5000);

        var prompt =
            "You are a JSON extraction service. Return ONLY valid JSON.\n" +
            "Extract ONLY the quantity table from a Sewing Worksheet OCR snippet.\n" +
            "Do NOT include any other keys. Do NOT wrap inside sewing_worksheet.\n" +
            "If the table is not present, return {\"quantity_lines\": null}.\n\n" +
            "Output schema:\n" +
            "{\n" +
            "  \"quantity_lines\": [\n" +
            "    {\n" +
            "      \"type\": \"Normal\"|\"Subtotal\"|\"GrandTotal\",\n" +
            "      \"style\": string|null,\n" +
            "      \"po\": string|null,\n" +
            "      \"xfty\": string|null,\n" +
            "      \"color_name\": string|null,\n" +
            "      \"color_code\": string|null,\n" +
            "      \"sizes\": {\n" +
            "        \"xxs_2_3\": number|null,\n" +
            "        \"xs_4_5\": number|null,\n" +
            "        \"s_6_7\": number|null,\n" +
            "        \"m_8_9\": number|null,\n" +
            "        \"l_10_11\": number|null,\n" +
            "        \"xl_12_13\": number|null,\n" +
            "        \"xxl_14_15\": number|null,\n" +
            "        \"xxxl_16\": number|null\n" +
            "      },\n" +
            "      \"total\": number|null\n" +
            "    }\n" +
            "  ]|null\n" +
            "}\n\n" +
            "OCR SNIPPET:\n" + snippet;

        return await CallClaudeJsonPatchAsync(maxTokens: 1800, prompt);
    }

    private async Task<JsonObject?> ExtractMeasurementRowsAsync(string ocrText)
    {
        var snippet = ExtractSnippet(
            ocrText,
            startMarkers: new[] { "PUNTOS DE MEDIDA", "MEASUREMENT SPECIFICATION", "ESPECIFICACION DE MEDIDAS" },
            endMarkers: new[] { "5.  DETALLES", "8.", "ETIQUETAS", "Page" },
            fallbackMaxChars: 9000);

        var prompt =
            "You are a JSON extraction service. Return ONLY valid JSON.\n" +
            "Extract ONLY the measurement specification table from a Sewing Worksheet OCR snippet.\n" +
            "Do NOT include any other keys. Do NOT wrap inside sewing_worksheet.\n" +
            "Return every row you can find (do not truncate).\n" +
            "If the table is not present, return {\"measurement_rows\": null}.\n\n" +
            "Output schema:\n" +
            "{\n" +
            "  \"measurement_rows\": [\n" +
            "    {\n" +
            "      \"name\": string,\n" +
            "      \"tolerance\": string,\n" +
            "      \"xxs_2_3\": string,\n" +
            "      \"xs_4_5\": string,\n" +
            "      \"s_6_7\": string,\n" +
            "      \"m_8_9\": string,\n" +
            "      \"l_10_11\": string,\n" +
            "      \"xl_12_13\": string,\n" +
            "      \"xxl_14_15\": string,\n" +
            "      \"xxxl_16\": string\n" +
            "    }\n" +
            "  ]|null\n" +
            "}\n\n" +
            "OCR SNIPPET:\n" + snippet;

        return await CallClaudeJsonPatchAsync(maxTokens: 3500, prompt);
    }

    private async Task<JsonObject?> ExtractOrderProcedureAndCuttingNotesAsync(string ocrText)
    {
        var snippet = ExtractSnippet(
            ocrText,
            startMarkers: new[] { "3. PROCESO DEL ORDEN", "ORDER PROCEDURE", "CORTE - COSTURA", "1ANTES DE CORTAR" },
            endMarkers: new[] { "COSTURA/ SEWING", "DETALLES DE OPERACION", "PUNTOS DE MEDIDA", "Page" },
            fallbackMaxChars: 6000);

        var prompt =
            "You are a JSON extraction service. Return ONLY valid JSON.\n" +
            "Extract ONLY these keys from a Sewing Worksheet OCR snippet: order_procedure, order_procedure_notes, cutting_detail_notes.\n" +
            "Do NOT include any other keys. Do NOT wrap inside sewing_worksheet.\n" +
            "If you cannot find a field, return null for that field.\n" +
            "For numbered instructions like '1ANTES DE CORTAR...' split into separate list items.\n\n" +
            "Output schema:\n" +
            "{\n" +
            "  \"order_procedure\": string|null,\n" +
            "  \"order_procedure_notes\": [string]|null,\n" +
            "  \"cutting_detail_notes\": [string]|null\n" +
            "}\n\n" +
            "OCR SNIPPET:\n" + snippet;

        return await CallClaudeJsonPatchAsync(maxTokens: 1200, prompt);
    }

    private async Task<JsonObject?> ExtractSewingNotesAsync(string ocrText)
    {
        var snippet = ExtractSnippet(
            ocrText,
            startMarkers: new[] { "COSTURA/ SEWING", "SEWING DETAIL", "DETALLES DE OPERACION" },
            endMarkers: new[] { "PUNTOS DE MEDIDA", "MEASUREMENT", "Page" },
            fallbackMaxChars: 7000);

        var prompt =
            "You are a JSON extraction service. Return ONLY valid JSON.\n" +
            "Extract ONLY sewing_detail_notes from a Sewing Worksheet OCR snippet.\n" +
            "Do NOT include any other keys. Do NOT wrap inside sewing_worksheet.\n" +
            "Split numbered instructions (1..12) into separate list items.\n" +
            "If not present, return {\"sewing_detail_notes\": null}.\n\n" +
            "Output schema:\n" +
            "{\n" +
            "  \"sewing_detail_notes\": [string]|null\n" +
            "}\n\n" +
            "OCR SNIPPET:\n" + snippet;

        return await CallClaudeJsonPatchAsync(maxTokens: 1400, prompt);
    }

    private async Task<JsonObject?> ExtractTrimPackingNotesAsync(string ocrText)
    {
        var snippet = ExtractSnippet(
            ocrText,
            startMarkers: new[] { "8. DETALLES DE ETIQUETAS", "TRIM & PACKING", "ETIQUETAS/ LABELS", "ACABADO/ PACKING" },
            endMarkers: new[] { "Page" },
            fallbackMaxChars: 3000);

        var prompt =
            "You are a JSON extraction service. Return ONLY valid JSON.\n" +
            "Extract ONLY trim_packing_notes from a Sewing Worksheet OCR snippet.\n" +
            "Do NOT include any other keys. Do NOT wrap inside sewing_worksheet.\n" +
            "If not present, return {\"trim_packing_notes\": null}.\n\n" +
            "Output schema:\n" +
            "{\n" +
            "  \"trim_packing_notes\": [string]|null\n" +
            "}\n\n" +
            "OCR SNIPPET:\n" + snippet;

        return await CallClaudeJsonPatchAsync(maxTokens: 900, prompt);
    }

    private async Task<JsonObject?> CallClaudeJsonPatchAsync(int maxTokens, string prompt)
    {
        var responseText = await CallClaudeMessagesApiAsync(
            maxTokens: maxTokens,
            messageContent: new object[]
            {
                new { type = "text", text = prompt }
            });

        var json = ExtractJsonObject(responseText);
        if (json == null)
            return null;

        try
        {
            var node = JsonNode.Parse(json);
            return node as JsonObject;
        }
        catch
        {
            return null;
        }
    }

    private static bool IsNullOrMissing(JsonNode? node)
    {
        if (node == null) return true;

        if (node is JsonValue)
        {
            if (string.Equals(node.ToJsonString(), "null", StringComparison.OrdinalIgnoreCase))
                return true;

            // Only treat empty-string as "missing". If it's a number/bool, it's not missing.
            var val = (JsonValue)node;
            if (val.TryGetValue<string?>(out var s))
                return string.IsNullOrWhiteSpace(s);

            return false;
        }

        if (node is JsonArray arr)
            return arr.Count == 0;

        if (node is JsonObject obj)
            return obj.Count == 0;

        return false;
    }

    private static string ExtractSnippet(string text, string[] startMarkers, string[] endMarkers, int fallbackMaxChars)
    {
        if (string.IsNullOrWhiteSpace(text))
            return string.Empty;

        var startIndex = -1;
        foreach (var m in startMarkers)
        {
            var idx = text.IndexOf(m, StringComparison.OrdinalIgnoreCase);
            if (idx >= 0)
            {
                startIndex = idx;
                break;
            }
        }

        if (startIndex < 0)
            return text.Length <= fallbackMaxChars ? text : text.Substring(0, fallbackMaxChars);

        var endIndex = -1;
        foreach (var m in endMarkers)
        {
            var idx = text.IndexOf(m, startIndex + 1, StringComparison.OrdinalIgnoreCase);
            if (idx >= 0)
            {
                endIndex = idx;
                break;
            }
        }

        if (endIndex < 0)
        {
            endIndex = Math.Min(text.Length, startIndex + fallbackMaxChars);
        }

        var length = Math.Max(0, endIndex - startIndex);
        if (length == 0)
            return text.Length <= fallbackMaxChars ? text : text.Substring(0, fallbackMaxChars);

        return text.Substring(startIndex, length);
    }

    private static string NormalizeClaudePageJson(string json)
    {
        using var doc = JsonDocument.Parse(json);
        if (doc.RootElement.ValueKind != JsonValueKind.Object)
            return json;

        var root = doc.RootElement;
        if (root.TryGetProperty("template_type", out _))
            return json;

        if (root.TryGetProperty("sewing_worksheet", out var sewingWorksheetElement))
        {
            var sewingWorksheet = JsonSerializer.Deserialize<object>(sewingWorksheetElement.GetRawText());
            var wrapper = new Dictionary<string, object?>
            {
                ["template_type"] = "sewing_worksheet",
                ["sewing_worksheet"] = sewingWorksheet,
                ["generic_document"] = null
            };
            return JsonSerializer.Serialize(wrapper);
        }

        if (root.TryGetProperty("generic_document", out var genericDocumentElement))
        {
            var genericDocument = JsonSerializer.Deserialize<object>(genericDocumentElement.GetRawText());
            var wrapper = new Dictionary<string, object?>
            {
                ["template_type"] = "generic_document",
                ["sewing_worksheet"] = null,
                ["generic_document"] = genericDocument
            };
            return JsonSerializer.Serialize(wrapper);
        }

        if (LooksLikeSewingWorksheetHeader(root))
        {
            var header = JsonSerializer.Deserialize<object>(root.GetRawText());
            var sewingWorksheet = new Dictionary<string, object?>
            {
                ["header"] = header,
                ["order_info"] = null,
                ["fabric_info"] = null,
                ["quantity_lines"] = null,
                ["order_procedure"] = null,
                ["order_procedure_notes"] = null,
                ["cutting_detail_notes"] = null,
                ["sewing_detail_notes"] = null,
                ["trim_packing_notes"] = null,
                ["labels_info"] = null,
                ["design_images"] = null,
                ["measurement_rows"] = null
            };

            var wrapper = new Dictionary<string, object?>
            {
                ["template_type"] = "sewing_worksheet",
                ["sewing_worksheet"] = sewingWorksheet,
                ["generic_document"] = null
            };
            return JsonSerializer.Serialize(wrapper);
        }

        return json;
    }

    private static bool LooksLikeSewingWorksheetHeader(JsonElement root)
    {
        return root.TryGetProperty("contact", out _)
            || root.TryGetProperty("revised_date", out _)
            || root.TryGetProperty("requested_by", out _)
            || root.TryGetProperty("work_plant", out _)
            || root.TryGetProperty("document_date", out _);
    }

    public async Task<object> AnalyzeDesignImageAsync(byte[] imageContent, string fileName)
    {
        if (string.IsNullOrWhiteSpace(_apiKey))
        {
            throw new InvalidOperationException("CLAUDE_API_KEY is not configured");
        }

        try
        {
            var mediaType = GetImageMediaType(fileName) ?? "image/png";
            var base64 = Convert.ToBase64String(imageContent);

            var prompt =
                "You are a JSON analysis service.\n" +
                "Return ONLY valid JSON (no markdown, no explanations, no code fences).\n" +
                "Analyze the image and produce a structured design analysis.\n" +
                "If unsure, use nulls and low confidence.\n\n" +
                "JSON schema (use exactly these keys):\n" +
                "{\n" +
                "  \"tipo_prenda\": string|null,\n" +
                "  \"descripcion_general\": string|null,\n" +
                "  \"color_actual\": string|null,\n" +
                "  \"material_aparente\": string|null,\n" +
                "  \"estilo\": string|null,\n" +
                "  \"cambios_sugeridos\": [{\"descripcion\": string|null, \"impacto\": string|null, \"prioridad\": string|null}],\n" +
                "  \"textos_detectados\": [{\"texto\": string|null, \"ubicacion\": string|null}],\n" +
                "  \"observaciones_adicionales\": string|null,\n" +
                "  \"calidad_imagen\": string|null,\n" +
                "  \"confianza_analisis\": string|null\n" +
                "}";

            var responseText = await CallClaudeMessagesApiAsync(
                maxTokens: 900,
                messageContent: new object[]
                {
                    new
                    {
                        type = "image",
                        source = new { type = "base64", media_type = mediaType, data = base64 }
                    },
                    new { type = "text", text = prompt }
                });

            var json = ExtractJsonObject(responseText);
            if (json == null)
            {
                throw new Exception("Claude response did not contain valid JSON");
            }

            return JsonSerializer.Deserialize<object>(json) ?? throw new Exception("Claude JSON could not be parsed");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "AiService Claude vision call failed.");
            throw;
        }
    }

    private static List<(int PageNumber, string Text)> SplitPages(string text)
    {
        var lines = text.Replace("\r\n", "\n").Split('\n');
        var pages = new List<(int PageNumber, string Text)>();
        var currentPage = 1;
        var sb = new StringBuilder();
        var hasMarkers = false;

        foreach (var raw in lines)
        {
            var line = raw.TrimEnd();
            if (line.StartsWith("--- PAGE ", StringComparison.OrdinalIgnoreCase) && line.EndsWith(" ---", StringComparison.Ordinal))
            {
                hasMarkers = true;
                if (sb.Length > 0)
                {
                    pages.Add((currentPage, sb.ToString().Trim()));
                    sb.Clear();
                }

                var numberPart = line
                    .Replace("--- PAGE ", string.Empty, StringComparison.OrdinalIgnoreCase)
                    .Replace(" ---", string.Empty, StringComparison.Ordinal)
                    .Trim();

                currentPage = int.TryParse(numberPart, out var n) ? n : currentPage;
                continue;
            }

            sb.AppendLine(raw);
        }

        if (sb.Length > 0)
            pages.Add((currentPage, sb.ToString().Trim()));

        if (!hasMarkers)
            return new List<(int PageNumber, string Text)> { (1, text) };

        return pages.Where(p => !string.IsNullOrWhiteSpace(p.Text)).ToList();
    }

    private async Task<string> CallClaudeMessagesApiAsync(int maxTokens, object[] messageContent)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "https://api.anthropic.com/v1/messages");
        request.Headers.Add("x-api-key", _apiKey);
        request.Headers.Add("anthropic-version", "2023-06-01");
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

        var payload = new
        {
            model = _model,
            max_tokens = maxTokens,
            temperature = 0,
            messages = new object[]
            {
                new
                {
                    role = "user",
                    content = messageContent
                }
            }
        };

        request.Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");

        var response = await _httpClient.SendAsync(request);
        var responseBody = await response.Content.ReadAsStringAsync();

        if (!response.IsSuccessStatusCode)
        {
            _logger.LogError("Claude API error {StatusCode}: {Body}", (int)response.StatusCode, responseBody);
            throw new HttpRequestException($"Claude API error: {(int)response.StatusCode} - {responseBody}");
        }

        using var doc = JsonDocument.Parse(responseBody);
        if (doc.RootElement.TryGetProperty("content", out var contentArray) && contentArray.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in contentArray.EnumerateArray())
            {
                if (item.TryGetProperty("type", out var type) && type.GetString() == "text" &&
                    item.TryGetProperty("text", out var text))
                {
                    return text.GetString() ?? string.Empty;
                }
            }
        }

        return responseBody;
    }

    private static string? ExtractJsonObject(string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;

        var cleaned = StripCodeFences(text).Trim();

        if (TryParseJson(cleaned))
            return cleaned;

        return FindFirstValidJsonSubstring(cleaned);
    }

    private static string StripCodeFences(string input)
    {
        var fenceStart = input.IndexOf("```", StringComparison.Ordinal);
        if (fenceStart < 0) return input;

        var fenceEnd = input.IndexOf("```", fenceStart + 3, StringComparison.Ordinal);
        if (fenceEnd < 0) return input;

        var inner = input.Substring(fenceStart + 3, fenceEnd - (fenceStart + 3)).Trim();

        var nl = inner.IndexOf('\n');
        if (nl > 0)
        {
            var firstLine = inner.Substring(0, nl).Trim();
            if (firstLine.Equals("json", StringComparison.OrdinalIgnoreCase))
                inner = inner.Substring(nl + 1).Trim();
        }

        return inner;
    }

    private static bool TryParseJson(string candidate)
    {
        if (string.IsNullOrWhiteSpace(candidate)) return false;
        try
        {
            JsonDocument.Parse(candidate);
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static string? FindFirstValidJsonSubstring(string text)
    {
        const int maxStartCandidates = 50;
        const int maxAttempts = 1000;

        var starts = new List<(int Index, char StartChar, char EndChar)>();
        for (var i = 0; i < text.Length && starts.Count < maxStartCandidates; i++)
        {
            if (text[i] == '{') starts.Add((i, '{', '}'));
            else if (text[i] == '[') starts.Add((i, '[', ']'));
        }

        var attempts = 0;
        foreach (var (startIndex, _, endChar) in starts)
        {
            for (var endIndex = text.Length - 1; endIndex > startIndex; endIndex--)
            {
                if (text[endIndex] != endChar) continue;
                attempts++;
                if (attempts > maxAttempts) return null;

                var candidate = text.Substring(startIndex, endIndex - startIndex + 1).Trim();
                if (TryParseJson(candidate))
                    return candidate;
            }
        }

        return null;
    }

    private static string? GetImageMediaType(string fileName)
    {
        var ext = Path.GetExtension(fileName).ToLowerInvariant();
        return ext switch
        {
            ".jpg" or ".jpeg" => "image/jpeg",
            ".png" => "image/png",
            ".webp" => "image/webp",
            ".gif" => "image/gif",
            ".bmp" => "image/bmp",
            ".tif" or ".tiff" => "image/tiff",
            _ => null
        };
    }

    private static string? NullIfEmpty(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value;
    }
}
