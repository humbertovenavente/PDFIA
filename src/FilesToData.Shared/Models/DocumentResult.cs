using System.Text.Json.Serialization;

namespace FilesToData.Shared.Models;

/// <summary>
/// Result for DOCUMENT mode processing
/// </summary>
public class DocumentResult
{
    [JsonPropertyName("tipo_documento")]
    public string TipoDocumento { get; set; } = "otro";

    [JsonPropertyName("numero_documento")]
    public string? NumeroDocumento { get; set; }

    [JsonPropertyName("fecha_emision")]
    public string? FechaEmision { get; set; }

    [JsonPropertyName("fecha_vencimiento")]
    public string? FechaVencimiento { get; set; }

    [JsonPropertyName("emisor")]
    public DocumentParty? Emisor { get; set; }

    [JsonPropertyName("receptor")]
    public DocumentParty? Receptor { get; set; }

    [JsonPropertyName("items")]
    public List<DocumentItem> Items { get; set; } = new();

    [JsonPropertyName("subtotal")]
    public decimal? Subtotal { get; set; }

    [JsonPropertyName("impuestos")]
    public decimal? Impuestos { get; set; }

    [JsonPropertyName("total")]
    public decimal? Total { get; set; }

    [JsonPropertyName("moneda")]
    public string Moneda { get; set; } = "MXN";

    [JsonPropertyName("notas")]
    public string? Notas { get; set; }

    [JsonPropertyName("metodo_pago")]
    public string? MetodoPago { get; set; }

    [JsonPropertyName("condiciones_pago")]
    public string? CondicionesPago { get; set; }
}

/// <summary>
/// Party in a document (emisor/receptor)
/// </summary>
public class DocumentParty
{
    [JsonPropertyName("nombre")]
    public string? Nombre { get; set; }

    [JsonPropertyName("rfc")]
    public string? Rfc { get; set; }

    [JsonPropertyName("direccion")]
    public string? Direccion { get; set; }

    [JsonPropertyName("telefono")]
    public string? Telefono { get; set; }

    [JsonPropertyName("email")]
    public string? Email { get; set; }
}

/// <summary>
/// Line item in a document
/// </summary>
public class DocumentItem
{
    [JsonPropertyName("descripcion")]
    public string Descripcion { get; set; } = string.Empty;

    [JsonPropertyName("cantidad")]
    public decimal Cantidad { get; set; } = 1;

    [JsonPropertyName("unidad")]
    public string? Unidad { get; set; }

    [JsonPropertyName("precio_unitario")]
    public decimal PrecioUnitario { get; set; }

    [JsonPropertyName("importe")]
    public decimal Importe { get; set; }
}
