using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace FilesToData.Api.Services;

/// <summary>
/// Stub de servicio de IA. No llama a Claude; devuelve estructuras simuladas.
/// Esto permite compilar y probar el flujo end-to-end sin depender de SDKs externos.
/// </summary>
public class AiService : IAiService
{
    private readonly ILogger<AiService> _logger;

    public AiService(ILogger<AiService> logger)
    {
        _logger = logger;
    }

    public Task<object> ExtractDocumentDataAsync(string maskedText)
    {
        // Resultado mínimo simulado
        var result = new
        {
            tipo_documento = "desconocido",
            numero_documento = (string?)null,
            fecha_emision = (string?)null,
            fecha_vencimiento = (string?)null,
            emisor = new
            {
                nombre = "[EMISOR_STUB]",
                rfc = (string?)null,
                direccion = (string?)null,
                telefono = (string?)null,
                email = (string?)null
            },
            receptor = new
            {
                nombre = "[RECEPTOR_STUB]",
                rfc = (string?)null,
                direccion = (string?)null,
                telefono = (string?)null,
                email = (string?)null
            },
            items = Array.Empty<object>(),
            subtotal = (decimal?)null,
            impuestos = (decimal?)null,
            total = (decimal?)null,
            moneda = "MXN",
            notas = (string?)null,
            metodo_pago = (string?)null,
            condiciones_pago = (string?)null,
            raw_text = maskedText
        };

        _logger.LogInformation("AiService.ExtractDocumentDataAsync ejecutado en modo stub");
        return Task.FromResult((object)result);
    }

    public Task<object> AnalyzeDesignImageAsync(byte[] imageContent, string fileName)
    {
        // Resultado mínimo simulado para imágenes de diseño
        var result = new
        {
            tipo_prenda = "desconocido",
            descripcion_general = "Análisis de diseño no implementado (stub)",
            color_actual = (string?)null,
            material_aparente = (string?)null,
            estilo = (string?)null,
            cambios_sugeridos = Array.Empty<object>(),
            textos_detectados = Array.Empty<object>(),
            observaciones_adicionales = (string?)null,
            calidad_imagen = "desconocida",
            confianza_analisis = "baja"
        };

        _logger.LogInformation("AiService.AnalyzeDesignImageAsync ejecutado en modo stub");
        return Task.FromResult((object)result);
    }
}
