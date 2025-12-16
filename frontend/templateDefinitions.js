/**
 * Template definitions for different document types.
 * Mirrors the backend template_definitions.py for consistency.
 */

const TEMPLATE_DEFINITIONS = {
  // Standard J.Crew Sewing Worksheet
  sewing_worksheet_jcrew: {
    name: "Sewing Worksheet (J.Crew Style)",
    exportFormat: "jcrew",
    sections: [
      { key: "header", title: "Header", type: "fields" },
      { key: "order_info", title: "1. ORDER INFO", type: "fields" },
      { key: "fabric_info", title: "2. FABRIC INFO", type: "fields" },
      { key: "order_procedure", title: "3. ORDER PROCEDURE", type: "text" },
      { key: "quantity_lines", title: "4. QTY PER STYLE, COLOR & PO", type: "table" },
      { key: "cutting_detail_notes", title: "5. CUTTING DETAIL", type: "list" },
      { key: "sewing_detail_notes", title: "6. SEWING DETAIL", type: "list" },
      { key: "measurement_rows", title: "7. MEASUREMENT SPECIFICATION", type: "table" },
      { key: "labels_info", title: "8. TRIM & PACKING DETAILS", type: "fields" }
    ]
  },

  // Korean/Spanish hybrid style
  sewing_worksheet_korean: {
    name: "Sewing Worksheet (Korean Style)",
    exportFormat: "korean",
    sections: [
      { key: "header", title: "Header", type: "fields" },
      { key: "order_info", title: "Order Information", type: "fields" },
      { key: "fabric_info", title: "Fabric Information", type: "fields" },
      { key: "trim_fabric", title: "Trim Fabric", type: "list" },
      { key: "quantity_lines", title: "Quantity by Style, Color & PO", type: "table" },
      { key: "yield_info", title: "요척", type: "fields" },
      { key: "order_procedure", title: "Production Process", type: "text" },
      { key: "measurement_rows", title: "Measurement Specification", type: "table" },
      { key: "important_notes", title: "IMPORTANT INFORMATION", type: "list" }
    ]
  },

  // Target style
  sewing_worksheet_target: {
    name: "Sewing Worksheet (Target Style)",
    exportFormat: "target",
    sections: [
      { key: "header", title: "SEWING WORKSHEET", type: "fields" },
      { key: "order_info", title: "Order Information", type: "fields" },
      { key: "quantity_lines", title: "ORDER QUANTITY", type: "table" },
      { key: "cutting_detail_notes", title: "CUTTING", type: "list" },
      { key: "sewing_detail_notes", title: "SEWING", type: "list" },
      { key: "order_procedure", title: "PROCESS", type: "text" }
    ]
  },

  // Default/unknown - uses J.Crew format
  sewing_worksheet: {
    name: "Sewing Worksheet",
    exportFormat: "jcrew",
    sections: [
      { key: "header", title: "Header", type: "fields" },
      { key: "order_info", title: "1. ORDER INFO", type: "fields" },
      { key: "fabric_info", title: "2. FABRIC INFO", type: "fields" },
      { key: "order_procedure", title: "3. ORDER PROCEDURE", type: "text" },
      { key: "quantity_lines", title: "4. QTY PER STYLE, COLOR & PO", type: "table" },
      { key: "cutting_detail_notes", title: "5. CUTTING DETAIL", type: "list" },
      { key: "sewing_detail_notes", title: "6. SEWING DETAIL", type: "list" },
      { key: "measurement_rows", title: "7. MEASUREMENT SPECIFICATION", type: "table" },
      { key: "labels_info", title: "8. TRIM & PACKING DETAILS", type: "fields" }
    ]
  },

  // Product specification / Tech Pack
  product_spec: {
    name: "Product Specification / Tech Pack",
    exportFormat: "product_spec",
    sections: [
      { key: "product_overview", title: "Product Overview", type: "fields" },
      { key: "table_of_contents", title: "Table of Contents", type: "table" },
      { key: "bom_product_materials", title: "Bill of Materials - Product Materials", type: "table" },
      { key: "bom_product_impressions", title: "Bill of Materials - Product Impressions", type: "table" },
      { key: "measurements_regular", title: "Measurements - Regular Sizes", type: "table" },
      { key: "measurements_plus", title: "Measurements - Plus Sizes", type: "table" },
      { key: "product_details_construction", title: "Product Details - Construction", type: "table" }
    ]
  }
};

// Field definitions for each section
const FIELD_DEFINITIONS = {
  header: {
    contact: { label: "CONTACT", type: "text" },
    document_date: { label: "DATE", type: "date" },
    revised_date: { label: "REVISED", type: "date" },
    requested_by: { label: "REQUESTED BY", type: "text" },
    work_plant: { label: "WORK PLANT", type: "text" },
    work_plant_address: { label: "Address", type: "text" },
    author: { label: "작성자", type: "text" }
  },
  order_info: {
    file: { label: "#FILE", type: "text" },
    buyer: { label: "BUYER", type: "text" },
    style: { label: "STYLE #", type: "text" },
    product: { label: "PRODUCT", type: "text" },
    season: { label: "SEASON", type: "text" },
    qty: { label: "QTY", type: "number" },
    ship_date: { label: "SHIP DATE", type: "date" },
    delivery: { label: "DELIVERY", type: "date" },
    cm_cost: { label: "CM COST", type: "text" },
    po: { label: "PO #", type: "text" }
  },
  fabric_info: {
    yarn: { label: "YARN", type: "text" },
    fabric: { label: "FABRIC 1", type: "text" },
    width: { label: "WIDTH", type: "text" },
    weight: { label: "WEIGHT", type: "text" },
    fabric2: { label: "FABRIC 2", type: "text" },
    width2: { label: "WIDTH 2", type: "text" },
    rib: { label: "RIB/부속", type: "text" },
    yield_total: { label: "YIELD", type: "text" },
    body_width: { label: "BODY 원단 폭", type: "text" }
  },
  labels_info: {
    folding_size: { label: "FOLDING SIZE", type: "text" },
    hangtag: { label: "HANGTAG", type: "text" },
    pieces_per_box: { label: "PIECES PER BOX", type: "text" }
  },
  yield_info: {
    body: { label: "BODY", type: "text" },
    rib: { label: "RIB", type: "text" },
    unit: { label: "Unit", type: "text" }
  }
};

// Column definitions for tables
const TABLE_COLUMNS = {
  quantity_lines: [
    { key: "style", label: "S#", width: 12 },
    { key: "po", label: "PO#", width: 10 },
    { key: "xfty", label: "XFTY", width: 8 },
    { key: "color_name", label: "COLOR", width: 15 },
    { key: "color_code", label: "COLOR CODE", width: 12 },
    { key: "sizes.xxs", label: "XXS (2/3)", width: 8, numeric: true },
    { key: "sizes.xs", label: "XS (4/5)", width: 8, numeric: true },
    { key: "sizes.s", label: "S (6/7)", width: 8, numeric: true },
    { key: "sizes.m", label: "M (8/9)", width: 8, numeric: true },
    { key: "sizes.l", label: "L (10/11)", width: 8, numeric: true },
    { key: "sizes.xl", label: "XL (12/13)", width: 8, numeric: true },
    { key: "sizes.xxl", label: "XXL (14/15)", width: 8, numeric: true },
    { key: "sizes.xxxl", label: "XXXL (16)", width: 8, numeric: true },
    { key: "sizes.1x", label: "1X", width: 8, numeric: true },
    { key: "sizes.2x", label: "2X", width: 8, numeric: true },
    { key: "sizes.3x", label: "3X", width: 8, numeric: true },
    { key: "sizes.4x", label: "4X", width: 8, numeric: true },
    { key: "delivery_date", label: "DELIVERY DATE", width: 12 },
    { key: "total", label: "TOTAL", width: 10, numeric: true }
  ],
  measurement_rows: [
    { key: "name", label: "Measurement Points", width: 25 },
    { key: "tolerance", label: "TOL (-/+)", width: 10, numeric: true },
    { key: "xxs", label: "XXS (2/3)", width: 8, numeric: true },
    { key: "xs", label: "XS (4/5)", width: 8, numeric: true },
    { key: "s", label: "S (6/7)", width: 8, numeric: true },
    { key: "m", label: "M (8/9)", width: 8, numeric: true },
    { key: "l", label: "L (10/11)", width: 8, numeric: true },
    { key: "xl", label: "XL (12/13)", width: 8, numeric: true },
    { key: "xxl", label: "XXL (14/15)", width: 8, numeric: true },
    { key: "xxxl", label: "XXXL (16)", width: 8, numeric: true }
  ]
};

// Size column mappings for normalization
const SIZE_MAPPINGS = {
  "xxs": ["xxs", "xxs_2_3", "2/3", "(2/3)"],
  "xs": ["xs", "xs_4_5", "4/5", "(4/5)"],
  "s": ["s", "s_6_7", "6/7", "(6/7)", "small"],
  "m": ["m", "m_8_9", "8/9", "(8/9)", "medium"],
  "l": ["l", "l_10_11", "10/11", "(10/11)", "large"],
  "xl": ["xl", "xl_12_13", "12/13", "(12/13)", "x-large"],
  "xxl": ["xxl", "xxl_14_15", "14/15", "(14/15)", "xx-large"],
  "xxxl": ["xxxl", "xxxl_16", "16", "(16)"],
  "1x": ["1x"],
  "2x": ["2x"],
  "3x": ["3x"],
  "4x": ["4x"]
};

/**
 * Get template definition by type
 */
function getTemplateDefinition(templateType) {
  // Normalize template type
  const normalizedType = (templateType || "").toLowerCase().replace(/[^a-z0-9_]/g, "_");
  
  // Try exact match first
  if (TEMPLATE_DEFINITIONS[normalizedType]) {
    return TEMPLATE_DEFINITIONS[normalizedType];
  }
  
  // Try partial matches
  for (const [key, def] of Object.entries(TEMPLATE_DEFINITIONS)) {
    if (normalizedType.includes(key) || key.includes(normalizedType)) {
      return def;
    }
  }
  
  // Default to sewing worksheet
  return TEMPLATE_DEFINITIONS.sewing_worksheet;
}

/**
 * Get field definitions for a section
 */
function getFieldDefinitions(sectionKey) {
  return FIELD_DEFINITIONS[sectionKey] || {};
}

/**
 * Get table column definitions
 */
function getTableColumns(tableKey) {
  return TABLE_COLUMNS[tableKey] || [];
}

/**
 * Normalize size key to standard format
 */
function normalizeSizeKey(sizeLabel) {
  const label = String(sizeLabel || "").toLowerCase().trim();
  
  for (const [normalizedKey, variants] of Object.entries(SIZE_MAPPINGS)) {
    if (variants.some(v => label.includes(v))) {
      return normalizedKey;
    }
  }
  
  return label.replace(/[^a-z0-9]/g, "_");
}

/**
 * Get nested value from object using dot notation
 */
function getNestedValue(obj, path) {
  if (!obj || !path) return undefined;
  const parts = path.split(".");
  let current = obj;
  for (const part of parts) {
    if (current === undefined || current === null) return undefined;
    current = current[part];
  }
  return current;
}

/**
 * Extract sewing worksheet data from various result structures
 */
function extractSewingWorksheetData(results) {
  let sw = {
    header: {},
    order_info: {},
    fabric_info: {},
    labels_info: {},
    yield_info: {},
    order_procedure: "",
    quantity_lines: [],
    measurement_rows: [],
    cutting_detail_notes: [],
    sewing_detail_notes: [],
    trim_packing_notes: [],
    important_notes: [],
    additional_tables: []
  };

  const mergeData = (source) => {
    if (!source) return;
    
    // Merge objects
    if (source.header) Object.assign(sw.header, source.header);
    if (source.order_info) Object.assign(sw.order_info, source.order_info);
    if (source.fabric_info) Object.assign(sw.fabric_info, source.fabric_info);
    if (source.labels_info) Object.assign(sw.labels_info, source.labels_info);
    if (source.yield_info) Object.assign(sw.yield_info, source.yield_info);
    
    // Merge text
    if (source.order_procedure) sw.order_procedure = source.order_procedure;
    
    // Merge arrays
    if (Array.isArray(source.quantity_lines)) sw.quantity_lines.push(...source.quantity_lines);
    if (Array.isArray(source.measurement_rows)) sw.measurement_rows.push(...source.measurement_rows);
    if (Array.isArray(source.cutting_detail_notes)) sw.cutting_detail_notes.push(...source.cutting_detail_notes);
    if (Array.isArray(source.order_procedure_notes)) sw.cutting_detail_notes.push(...source.order_procedure_notes);
    if (Array.isArray(source.sewing_detail_notes)) sw.sewing_detail_notes.push(...source.sewing_detail_notes);
    if (Array.isArray(source.trim_packing_notes)) sw.trim_packing_notes.push(...source.trim_packing_notes);
    if (Array.isArray(source.important_notes)) sw.important_notes.push(...source.important_notes);
    if (Array.isArray(source.additional_tables)) sw.additional_tables.push(...source.additional_tables);
  };

  // Check direct sewing_worksheet
  if (results.sewing_worksheet) {
    mergeData(results.sewing_worksheet);
  }

  // Check pages array
  if (Array.isArray(results.pages)) {
    for (const page of results.pages) {
      if (page?.data?.sewing_worksheet) {
        mergeData(page.data.sewing_worksheet);
      } else if (page?.sewing_worksheet) {
        mergeData(page.sewing_worksheet);
      } else if (page?.data) {
        mergeData(page.data);
      }
    }
  }

  // Check direct properties
  mergeData(results);

  return sw;
}

// Export for use in other modules
window.TEMPLATE_DEFINITIONS = TEMPLATE_DEFINITIONS;
window.FIELD_DEFINITIONS = FIELD_DEFINITIONS;
window.TABLE_COLUMNS = TABLE_COLUMNS;
window.SIZE_MAPPINGS = SIZE_MAPPINGS;
window.getTemplateDefinition = getTemplateDefinition;
window.getFieldDefinitions = getFieldDefinitions;
window.getTableColumns = getTableColumns;
window.normalizeSizeKey = normalizeSizeKey;
window.getNestedValue = getNestedValue;
window.extractSewingWorksheetData = extractSewingWorksheetData;
