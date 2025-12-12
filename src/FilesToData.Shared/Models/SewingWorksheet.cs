using System.Text.Json;
using System.Text.Json.Serialization;

namespace FilesToData.Shared.Models;

public class AiDocumentResult
{
    [JsonPropertyName("pages")]
    public List<AiDocumentPage> Pages { get; set; } = new();

    [JsonPropertyName("raw_text")]
    public string? RawText { get; set; }
}

public class AiDocumentPage
{
    [JsonPropertyName("page_number")]
    public int PageNumber { get; set; }

    [JsonPropertyName("raw_text")]
    public string? RawText { get; set; }

    [JsonPropertyName("data")]
    public JsonElement Data { get; set; }
}

public class AiTemplatePageData
{
    [JsonPropertyName("template_type")]
    public string? TemplateType { get; set; }

    [JsonPropertyName("sewing_worksheet")]
    public SewingWorksheetModel? SewingWorksheet { get; set; }
}

public class SewingWorksheetModel
{
    [JsonPropertyName("header")]
    public SewingWorksheetHeader Header { get; set; } = new();

    [JsonPropertyName("order_info")]
    public SewingWorksheetOrderInfo OrderInfo { get; set; } = new();

    [JsonPropertyName("fabric_info")]
    public SewingWorksheetFabricInfo FabricInfo { get; set; } = new();

    [JsonPropertyName("quantity_lines")]
    public List<QuantityLine> QuantityLines { get; set; } = new();

    [JsonPropertyName("order_procedure")]
    public string? OrderProcedure { get; set; }

    [JsonPropertyName("order_procedure_notes")]
    public List<string> OrderProcedureNotes { get; set; } = new();

    [JsonPropertyName("cutting_detail_notes")]
    public List<string> CuttingDetailNotes { get; set; } = new();

    [JsonPropertyName("sewing_detail_notes")]
    public List<string> SewingDetailNotes { get; set; } = new();

    [JsonPropertyName("trim_packing_notes")]
    public List<string> TrimPackingNotes { get; set; } = new();

    [JsonPropertyName("labels_info")]
    public LabelsPackingInfo LabelsInfo { get; set; } = new();

    [JsonPropertyName("design_images")]
    public List<string> DesignImages { get; set; } = new();

    [JsonPropertyName("measurement_rows")]
    public List<MeasurementRow> MeasurementRows { get; set; } = new();
}

public class LabelsPackingInfo
{
    [JsonPropertyName("folding_size")]
    public string? FoldingSize { get; set; }

    [JsonPropertyName("hangtag")]
    public string? Hangtag { get; set; }

    [JsonPropertyName("pieces_per_box")]
    public string? PiecesPerBox { get; set; }

    [JsonPropertyName("additional_notes")]
    public List<string> AdditionalNotes { get; set; } = new();
}

public class SewingWorksheetHeader
{
    [JsonPropertyName("contact")]
    public string? Contact { get; set; }

    [JsonPropertyName("revised_date")]
    public string? RevisedDate { get; set; }

    [JsonPropertyName("requested_by")]
    public string? RequestedBy { get; set; }

    [JsonPropertyName("requested_by_address")]
    public string? RequestedByAddress { get; set; }

    [JsonPropertyName("requested_by_phone")]
    public string? RequestedByPhone { get; set; }

    [JsonPropertyName("work_plant")]
    public string? WorkPlant { get; set; }

    [JsonPropertyName("work_plant_address")]
    public string? WorkPlantAddress { get; set; }

    [JsonPropertyName("document_date")]
    public string? DocumentDate { get; set; }

    [JsonPropertyName("signatures")]
    public SignatureBlock Signatures { get; set; } = new();
}

public class SignatureBlock
{
    [JsonPropertyName("damdang")]
    public string? Damdang { get; set; }

    [JsonPropertyName("daeri")]
    public string? Daeri { get; set; }

    [JsonPropertyName("chajang")]
    public string? Chajang { get; set; }

    [JsonPropertyName("bujang")]
    public string? Bujang { get; set; }

    [JsonPropertyName("sangmu")]
    public string? Sangmu { get; set; }

    [JsonPropertyName("busajang")]
    public string? Busajang { get; set; }
}

public class SewingWorksheetOrderInfo
{
    [JsonPropertyName("file")]
    public string? File { get; set; }

    [JsonPropertyName("buyer")]
    public string? Buyer { get; set; }

    [JsonPropertyName("style")]
    public string? Style { get; set; }

    [JsonPropertyName("product")]
    public string? Product { get; set; }

    [JsonPropertyName("season")]
    public string? Season { get; set; }

    [JsonPropertyName("qty")]
    public int? Qty { get; set; }

    [JsonPropertyName("ship_date")]
    public string? ShipDate { get; set; }

    [JsonPropertyName("cm_cost")]
    public decimal? CmCost { get; set; }

    [JsonPropertyName("total_usd")]
    public decimal? TotalUsd { get; set; }

    [JsonPropertyName("grand_total_usd")]
    public decimal? GrandTotalUsd { get; set; }
}

public class SewingWorksheetFabricInfo
{
    [JsonPropertyName("yarn")]
    public string? Yarn { get; set; }

    [JsonPropertyName("fabric")]
    public string? Fabric { get; set; }

    [JsonPropertyName("width")]
    public string? Width { get; set; }

    [JsonPropertyName("weight")]
    public string? Weight { get; set; }

    [JsonPropertyName("fabric2")]
    public string? Fabric2 { get; set; }

    [JsonPropertyName("width2")]
    public string? Width2 { get; set; }

    [JsonPropertyName("yield_total")]
    public decimal? YieldTotal { get; set; }

    [JsonPropertyName("loss_comment")]
    public string? LossComment { get; set; }
}

public enum LineType
{
    Normal,
    Subtotal,
    GrandTotal
}

public class SizeBreakdown
{
    [JsonPropertyName("xxs_2_3")]
    public int? Xxs_2_3 { get; set; }

    [JsonPropertyName("xs_4_5")]
    public int? Xs_4_5 { get; set; }

    [JsonPropertyName("s_6_7")]
    public int? S_6_7 { get; set; }

    [JsonPropertyName("m_8_9")]
    public int? M_8_9 { get; set; }

    [JsonPropertyName("l_10_11")]
    public int? L_10_11 { get; set; }

    [JsonPropertyName("xl_12_13")]
    public int? Xl_12_13 { get; set; }

    [JsonPropertyName("xxl_14_15")]
    public int? Xxl_14_15 { get; set; }

    [JsonPropertyName("xxxl_16")]
    public int? Xxxl_16 { get; set; }
}

public class QuantityLine
{
    [JsonPropertyName("type")]
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public LineType Type { get; set; } = LineType.Normal;

    [JsonPropertyName("style")]
    public string? Style { get; set; }

    [JsonPropertyName("po")]
    public string? Po { get; set; }

    [JsonPropertyName("xfty")]
    public string? Xfty { get; set; }

    [JsonPropertyName("color_name")]
    public string? ColorName { get; set; }

    [JsonPropertyName("color_code")]
    public string? ColorCode { get; set; }

    [JsonPropertyName("sizes")]
    public SizeBreakdown Sizes { get; set; } = new();

    [JsonPropertyName("total")]
    public int? Total { get; set; }
}

public class MeasurementRow
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("tolerance")]
    public string Tolerance { get; set; } = string.Empty;

    [JsonPropertyName("xxs_2_3")]
    public string Xxs_2_3 { get; set; } = string.Empty;

    [JsonPropertyName("xs_4_5")]
    public string Xs_4_5 { get; set; } = string.Empty;

    [JsonPropertyName("s_6_7")]
    public string S_6_7 { get; set; } = string.Empty;

    [JsonPropertyName("m_8_9")]
    public string M_8_9 { get; set; } = string.Empty;

    [JsonPropertyName("l_10_11")]
    public string L_10_11 { get; set; } = string.Empty;

    [JsonPropertyName("xl_12_13")]
    public string Xl_12_13 { get; set; } = string.Empty;

    [JsonPropertyName("xxl_14_15")]
    public string Xxl_14_15 { get; set; } = string.Empty;

    [JsonPropertyName("xxxl_16")]
    public string Xxxl_16 { get; set; } = string.Empty;
}

public class SewingWorksheetGrandTotal
{
    [JsonPropertyName("sizes")]
    public SizeBreakdown Sizes { get; set; } = new();

    [JsonPropertyName("total")]
    public int? Total { get; set; }
}
