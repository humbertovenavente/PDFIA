using System.Text.Json.Serialization;

namespace FilesToData.Shared.Models;

/// <summary>
/// Result for DESIGN mode processing
/// </summary>
public class DesignResult
{
    [JsonPropertyName("tipo_prenda")]
    public string TipoPrenda { get; set; } = string.Empty;

    [JsonPropertyName("descripcion_general")]
    public string? DescripcionGeneral { get; set; }

    [JsonPropertyName("color_actual")]
    public string? ColorActual { get; set; }

    [JsonPropertyName("material_aparente")]
    public string? MaterialAparente { get; set; }

    [JsonPropertyName("estilo")]
    public string? Estilo { get; set; }

    [JsonPropertyName("cambios_sugeridos")]
    public List<DesignChange> CambiosSugeridos { get; set; } = new();

    [JsonPropertyName("textos_detectados")]
    public List<DetectedText> TextosDetectados { get; set; } = new();

    [JsonPropertyName("observaciones_adicionales")]
    public string? ObservacionesAdicionales { get; set; }

    [JsonPropertyName("calidad_imagen")]
    public string CalidadImagen { get; set; } = "aceptable";

    [JsonPropertyName("confianza_analisis")]
    public string ConfianzaAnalisis { get; set; } = "media";
}

/// <summary>
/// Suggested design change
/// </summary>
public class DesignChange
{
    [JsonPropertyName("zona")]
    public string Zona { get; set; } = string.Empty;

    [JsonPropertyName("tipo_marca")]
    public string? TipoMarca { get; set; }

    [JsonPropertyName("descripcion")]
    public string Descripcion { get; set; } = string.Empty;

    [JsonPropertyName("prioridad")]
    public string Prioridad { get; set; } = "media";
}

/// <summary>
/// Detected text in image
/// </summary>
public class DetectedText
{
    [JsonPropertyName("texto")]
    public string Texto { get; set; } = string.Empty;

    [JsonPropertyName("ubicacion")]
    public string? Ubicacion { get; set; }

    [JsonPropertyName("tipo")]
    public string? Tipo { get; set; }
}
