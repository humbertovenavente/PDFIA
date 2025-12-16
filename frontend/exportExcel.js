// J.Crew Sewing Worksheet Excel Export - Single Sheet Format
// Uses template definitions from templateDefinitions.js

async function exportToExcelSewingWorksheet(results, workbook) {
  const CELESTE = 'FFDEEAF6';
  const YELLOW = 'FFFFFF00';
  const LIGHT_GRAY = 'FFF2F2F2';
  const BORDER_STYLE = { style: 'thin', color: { argb: 'FF000000' } };
  const BORDER_ALL = { top: BORDER_STYLE, bottom: BORDER_STYLE, left: BORDER_STYLE, right: BORDER_STYLE };

  const applyBorder = (ws, startCol, endCol, rowNum) => {
    for (let c = startCol; c <= endCol; c++) {
      ws.getCell(rowNum, c).border = BORDER_ALL;
    }
  };

  // Use the extractSewingWorksheetData function from templateDefinitions.js if available
  let sw;
  if (typeof window.extractSewingWorksheetData === 'function') {
    sw = window.extractSewingWorksheetData(results);
  } else {
    // Fallback to inline extraction
    sw = { header: {}, order_info: {}, fabric_info: {}, labels_info: {}, yield_info: {}, quantity_lines: [], measurement_rows: [], cutting_detail_notes: [], sewing_detail_notes: [], trim_packing_notes: [], important_notes: [], additional_tables: [], order_procedure: '' };
  }
  
  const mergeSwData = (psw) => {
    if (!psw) return;
    Object.assign(sw.header, psw.header || {});
    Object.assign(sw.order_info, psw.order_info || {});
    Object.assign(sw.fabric_info, psw.fabric_info || {});
    Object.assign(sw.labels_info, psw.labels_info || {});
    if (psw.yield_info) Object.assign(sw.yield_info, psw.yield_info);
    if (psw.order_procedure) sw.order_procedure = psw.order_procedure;
    if (Array.isArray(psw.quantity_lines)) sw.quantity_lines.push(...psw.quantity_lines);
    if (Array.isArray(psw.measurement_rows)) sw.measurement_rows.push(...psw.measurement_rows);
    if (Array.isArray(psw.cutting_detail_notes)) sw.cutting_detail_notes.push(...psw.cutting_detail_notes);
    if (Array.isArray(psw.order_procedure_notes)) sw.cutting_detail_notes.push(...psw.order_procedure_notes);
    if (Array.isArray(psw.sewing_detail_notes)) sw.sewing_detail_notes.push(...psw.sewing_detail_notes);
    if (Array.isArray(psw.trim_packing_notes)) sw.trim_packing_notes.push(...psw.trim_packing_notes);
    if (Array.isArray(psw.important_notes)) sw.important_notes.push(...psw.important_notes);
    if (Array.isArray(psw.additional_tables)) sw.additional_tables.push(...psw.additional_tables);
  };

  // Helper to extract generic document data and map to sewing worksheet fields
  const extractGenericData = (data) => {
    if (!data) return;
    
    // Map product_factura / product_overview fields
    if (data.product_overview) {
      const po = data.product_overview;
      sw.order_info.file = sw.order_info.file || po.product_id || '';
      sw.order_info.style = sw.order_info.style || po.vendor_style_number || po.product_id || '';
      sw.order_info.product = sw.order_info.product || po.product_name || '';
      sw.order_info.buyer = sw.order_info.buyer || po.brand || '';
      sw.order_info.season = sw.order_info.season || po.design_cycle || '';
      sw.header.work_plant = sw.header.work_plant || po.workspace_name || '';
      sw.header.document_date = sw.header.document_date || po.set_dates || '';
      sw.header.contact = sw.header.contact || po.department || '';
    }
    
    // Map BOM materials to quantity lines
    if (Array.isArray(data.bom_product_materials)) {
      data.bom_product_materials.forEach(item => {
        sw.quantity_lines.push({
          style: item.material_id || item.connected_material_asset || '',
          po: item.use || '',
          xfty: '',
          color_name: item.material_name || item.additional_material_details || '',
          color_code: '',
          total: item.quantity || ''
        });
      });
    }
    
    // Map BOM impressions to quantity lines
    if (Array.isArray(data.bom_product_impressions_wide)) {
      data.bom_product_impressions_wide.forEach(item => {
        sw.quantity_lines.push({
          style: item.connected_material_asset || '',
          po: item.use || '',
          xfty: '',
          color_name: item.additional_material_details || '',
          color_code: '',
          sizes: {
            xxs_2_3: item.heather_gray || '',
            xs_4_5: item.navy || ''
          },
          total: ''
        });
      });
    }
    
    // Map product_details_construction to cutting/sewing notes
    if (Array.isArray(data.product_details_construction)) {
      data.product_details_construction.forEach(item => {
        const note = `${item.category || ''} - ${item.subcategory || ''}: ${item.detail || ''}`;
        if (item.subcategory?.toLowerCase().includes('topstitch') || item.category?.toLowerCase().includes('construction')) {
          sw.sewing_detail_notes.push(note);
        } else {
          sw.cutting_detail_notes.push(note);
        }
      });
    }
    
    // Map measurements
    if (Array.isArray(data.measurements_regular_wide)) {
      data.measurements_regular_wide.forEach(item => {
        sw.measurement_rows.push({
          name: item.measurement_point || item.name || '',
          tolerance: item.tolerance || '',
          xxs_2_3: item.xxs || item['2/3'] || '',
          xs_4_5: item.xs || item['4/5'] || '',
          s_6_7: item.s || item['6/7'] || '',
          m_8_9: item.m || item['8/9'] || '',
          l_10_11: item.l || item['10/11'] || '',
          xl_12_13: item.xl || item['12/13'] || '',
          xxl_14_15: item.xxl || item['14/15'] || '',
          xxxl_16: item.xxxl || item['16'] || ''
        });
      });
    }
    
    if (Array.isArray(data.measurements_plus_wide)) {
      data.measurements_plus_wide.forEach(item => {
        sw.measurement_rows.push({
          name: item.measurement_point || item.name || '',
          tolerance: item.tolerance || '',
          xxs_2_3: item.xxs || '',
          xs_4_5: item.xs || '',
          s_6_7: item.s || '',
          m_8_9: item.m || '',
          l_10_11: item.l || '',
          xl_12_13: item.xl || '',
          xxl_14_15: item.xxl || '',
          xxxl_16: item.xxxl || ''
        });
      });
    }
    
    // Map common fields from generic documents (facturas)
    if (data.emisor) {
      sw.header.contact = sw.header.contact || data.emisor.nombre || data.emisor.razon_social;
      sw.header.work_plant_address = sw.header.work_plant_address || data.emisor.direccion;
    }
    if (data.receptor) {
      sw.header.requested_by = sw.header.requested_by || data.receptor.nombre || data.receptor.razon_social;
    }
    if (data.fecha_emision) sw.header.document_date = sw.header.document_date || data.fecha_emision;
    if (data.numero_documento) sw.order_info.file = sw.order_info.file || data.numero_documento;
    if (data.moneda) sw.order_info.currency = data.moneda;
    if (data.total) sw.order_info.total_usd = sw.order_info.total_usd || data.total;
    if (Array.isArray(data.items)) {
      data.items.forEach(item => {
        sw.quantity_lines.push({
          style: item.codigo || '',
          po: '',
          xfty: '',
          color_name: item.descripcion || '',
          color_code: '',
          total: item.cantidad || item.importe || ''
        });
      });
    }
  };

  // Check if sewing_worksheet is directly on results
  if (results.sewing_worksheet) {
    mergeSwData(results.sewing_worksheet);
  }
  
  // Check pages array - this is the main structure used by the frontend
  if (results.pages) {
    results.pages.forEach(page => {
      // Primary location: page.data.sewing_worksheet (used by frontend)
      if (page?.data?.sewing_worksheet) {
        mergeSwData(page.data.sewing_worksheet);
      }
      // Alternative: page.sewing_worksheet
      else if (page?.sewing_worksheet) {
        mergeSwData(page.sewing_worksheet);
      }
      // Alternative: page.data is the sewing worksheet itself
      else if (page?.data?.template_type === 'sewing_worksheet') {
        mergeSwData(page.data);
      }
      // Fallback: try to extract from generic document structure
      else {
        const data = page?.data || page;
        if (data) {
          if (data.order_info) Object.assign(sw.order_info, data.order_info);
          if (data.fabric_info) Object.assign(sw.fabric_info, data.fabric_info);
          if (data.header) Object.assign(sw.header, data.header);
          if (data.labels_info) Object.assign(sw.labels_info, data.labels_info);
          if (Array.isArray(data.quantity_lines)) sw.quantity_lines.push(...data.quantity_lines);
          if (Array.isArray(data.measurement_rows)) sw.measurement_rows.push(...data.measurement_rows);
          if (data.order_procedure) sw.order_procedure = data.order_procedure;
          // Also try generic document extraction
          extractGenericData(data);
        }
      }
    });
  }
  
  // Also check for data directly on results (non-pages structure)
  if (results.order_info) Object.assign(sw.order_info, results.order_info);
  if (results.fabric_info) Object.assign(sw.fabric_info, results.fabric_info);
  if (results.header) Object.assign(sw.header, results.header);
  if (Array.isArray(results.items)) {
    results.items.forEach(item => {
      sw.quantity_lines.push({
        style: item.codigo || '',
        po: '',
        xfty: '',
        color_name: item.descripcion || '',
        color_code: '',
        total: item.cantidad || item.importe || ''
      });
    });
  }
  if (Array.isArray(results.quantity_lines)) sw.quantity_lines.push(...results.quantity_lines);
  if (Array.isArray(results.measurement_rows)) sw.measurement_rows.push(...results.measurement_rows);
  extractGenericData(results);

  // Debug: log what data we found
  console.log('Export data extracted:', {
    header: sw.header,
    orderInfo: sw.order_info,
    fabricInfo: sw.fabric_info,
    labelsInfo: sw.labels_info,
    quantityLines: sw.quantity_lines.length,
    measurementRows: sw.measurement_rows.length,
    orderProcedure: sw.order_procedure
  });

  const header = sw.header;
  const orderInfo = sw.order_info;
  const fabricInfo = sw.fabric_info;
  const labelsInfo = sw.labels_info;

  const ws = workbook.addWorksheet('Sewing Worksheet');
  
  // 17 columns
  ws.columns = [
    { width: 16 }, { width: 12 }, { width: 10 }, { width: 18 }, { width: 14 },
    { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 },
    { width: 10 }, { width: 11 }, { width: 11 }, { width: 10 }, { width: 10 },
    { width: 10 }, { width: 12 }
  ];

  let row = 1;

  // ROW 1: TITLE
  ws.mergeCells(row, 1, row, 17);
  ws.getCell(row, 1).value = 'SEWING WORKSHEET';
  ws.getCell(row, 1).font = { bold: true, size: 16 };
  ws.getCell(row, 1).alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getCell(row, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CELESTE } };
  applyBorder(ws, 1, 17, row);
  ws.getRow(row).height = 26;
  row++;

  // ROW 2: CONTACTO / FECHA
  ws.mergeCells(row, 1, row, 3);
  ws.getCell(row, 1).value = 'CONTACTO/CONTACT/담당자';
  ws.getCell(row, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CELESTE } };
  applyBorder(ws, 1, 3, row);
  
  ws.mergeCells(row, 4, row, 5);
  ws.getCell(row, 4).value = header.contact || '';
  applyBorder(ws, 4, 5, row);
  
  ws.mergeCells(row, 6, row, 7);
  ws.getCell(row, 6).value = 'DATE';
  ws.getCell(row, 6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CELESTE } };
  applyBorder(ws, 6, 7, row);
  
  ws.mergeCells(row, 8, row, 9);
  ws.getCell(row, 8).value = header.document_date || '';
  applyBorder(ws, 8, 9, row);
  
  ws.mergeCells(row, 10, row, 11);
  ws.getCell(row, 10).value = header.revised_date ? `REVISED ${header.revised_date}` : '';
  ws.getCell(row, 10).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: YELLOW } };
  ws.getCell(row, 10).font = { bold: true, color: { argb: 'FFFF0000' } };
  applyBorder(ws, 10, 11, row);
  
  // Signature boxes
  ['담당', '대리', '차장', '부장', '상무', '부사장'].forEach((lbl, i) => {
    ws.getCell(row, 12 + i).value = lbl;
    ws.getCell(row, 12 + i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CELESTE } };
    ws.getCell(row, 12 + i).border = BORDER_ALL;
    ws.getCell(row, 12 + i).alignment = { horizontal: 'center' };
  });
  row++;

  // ROW 3: SOLICITADO POR / PLANTA
  ws.mergeCells(row, 1, row, 2);
  ws.getCell(row, 1).value = 'REQUESTED BY';
  ws.getCell(row, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CELESTE } };
  applyBorder(ws, 1, 2, row);
  
  ws.mergeCells(row, 3, row, 5);
  ws.getCell(row, 3).value = header.requested_by || '';
  applyBorder(ws, 3, 5, row);
  
  ws.mergeCells(row, 6, row, 7);
  ws.getCell(row, 6).value = 'WORK PLANT';
  ws.getCell(row, 6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CELESTE } };
  applyBorder(ws, 6, 7, row);
  
  ws.mergeCells(row, 8, row, 11);
  ws.getCell(row, 8).value = header.work_plant || '';
  applyBorder(ws, 8, 11, row);
  
  for (let i = 12; i <= 17; i++) ws.getCell(row, i).border = BORDER_ALL;
  row++;

  // ROW 4: Addresses
  ws.mergeCells(row, 1, row, 5);
  ws.getCell(row, 1).value = header.requested_by_address || '';
  ws.getCell(row, 1).font = { size: 8 };
  applyBorder(ws, 1, 5, row);
  ws.mergeCells(row, 6, row, 11);
  ws.getCell(row, 6).value = header.work_plant_address || '';
  ws.getCell(row, 6).font = { size: 8 };
  applyBorder(ws, 6, 11, row);
  for (let i = 12; i <= 17; i++) ws.getCell(row, i).border = BORDER_ALL;
  row++;

  // Section 1 & 2 Headers
  ws.mergeCells(row, 1, row, 7);
  ws.getCell(row, 1).value = '1. ORDER INFO';
  ws.getCell(row, 1).font = { bold: true };
  ws.getCell(row, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CELESTE } };
  applyBorder(ws, 1, 7, row);
  
  ws.mergeCells(row, 8, row, 15);
  ws.getCell(row, 8).value = '2. FABRIC INFO';
  ws.getCell(row, 8).font = { bold: true };
  ws.getCell(row, 8).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CELESTE } };
  applyBorder(ws, 8, 15, row);
  
  ws.mergeCells(row, 16, row, 17);
  ws.getCell(row, 16).value = '그림';
  ws.getCell(row, 16).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CELESTE } };
  ws.getCell(row, 16).alignment = { horizontal: 'center' };
  applyBorder(ws, 16, 17, row);
  row++;

  // Order Info & Fabric Info rows
  const infoRows = [
    ['#FILE', orderInfo.file, 'HILAZA/ YARN/사종', fabricInfo.yarn],
    ['CLIENTE/ BUYER/바이어', orderInfo.buyer, 'TELA 1/ FABRIC/원단', fabricInfo.fabric],
    ['STYLE # / # ESTILO', orderInfo.style, 'ANCHO/ WIDTH/폭', fabricInfo.width],
    ['PRODUCTO/ PRODUCT/제품', orderInfo.product, 'PESO/WEIGHT/중량', fabricInfo.weight],
    ['TEMPORADA/SEASON', orderInfo.season, 'TELA 2/ FABRIC2/ 원단2', fabricInfo.fabric2],
    ['CANTIDAD/ QTY/수량', orderInfo.qty, 'ANCHO/ WIDTH/폭', fabricInfo.width2],
    ['ENTREGA/ SHIPDATE/납기', orderInfo.ship_date, '', ''],
    ['COSTO/ CM/공임', orderInfo.cm_cost, 'CONSUMO/ YIELD/요척', fabricInfo.yield_total],
  ];

  const imgStartRow = row;
  infoRows.forEach(([l1, v1, l2, v2], idx) => {
    ws.mergeCells(row, 1, row, 3);
    ws.getCell(row, 1).value = l1;
    ws.getCell(row, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CELESTE } };
    applyBorder(ws, 1, 3, row);
    
    ws.mergeCells(row, 4, row, 7);
    ws.getCell(row, 4).value = v1 || '';
    applyBorder(ws, 4, 7, row);
    
    ws.mergeCells(row, 8, row, 10);
    ws.getCell(row, 8).value = l2;
    ws.getCell(row, 8).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CELESTE } };
    applyBorder(ws, 8, 10, row);
    
    ws.mergeCells(row, 11, row, 15);
    ws.getCell(row, 11).value = v2 || '';
    applyBorder(ws, 11, 15, row);
    
    if (idx === 0) ws.mergeCells(imgStartRow, 16, imgStartRow + 7, 17);
    row++;
  });

  // Section 3: Order Procedure
  ws.mergeCells(row, 1, row, 17);
  ws.getCell(row, 1).value = '3. ORDER PROCEDURE';
  ws.getCell(row, 1).font = { bold: true };
  ws.getCell(row, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CELESTE } };
  applyBorder(ws, 1, 17, row);
  row++;

  ws.mergeCells(row, 1, row, 17);
  ws.getCell(row, 1).value = sw.order_procedure || 'CUT - SEW - PACK';
  ws.getCell(row, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: YELLOW } };
  ws.getCell(row, 1).font = { bold: true };
  ws.getCell(row, 1).alignment = { horizontal: 'center' };
  applyBorder(ws, 1, 17, row);
  row++;

  // Section 4: Quantity
  ws.mergeCells(row, 1, row, 17);
  ws.getCell(row, 1).value = '4. QTY PER STYLE, COLOR & PO';
  ws.getCell(row, 1).font = { bold: true };
  ws.getCell(row, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CELESTE } };
  applyBorder(ws, 1, 17, row);
  row++;

  // Qty headers row 1
  ['S#', 'PO#', 'XFTY', 'COLOR', 'COLOR CODE'].forEach((h, i) => {
    ws.getCell(row, i + 1).value = h;
    ws.getCell(row, i + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CELESTE } };
    ws.getCell(row, i + 1).border = BORDER_ALL;
    ws.getCell(row, i + 1).alignment = { horizontal: 'center' };
  });
  ws.mergeCells(row, 6, row, 16);
  ws.getCell(row, 6).value = 'SIZE';
  ws.getCell(row, 6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CELESTE } };
  ws.getCell(row, 6).alignment = { horizontal: 'center' };
  applyBorder(ws, 6, 16, row);
  ws.getCell(row, 17).value = 'TOTAL';
  ws.getCell(row, 17).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CELESTE } };
  ws.getCell(row, 17).border = BORDER_ALL;
  row++;

  // Qty headers row 2 - sizes
  for (let i = 1; i <= 5; i++) {
    ws.getCell(row, i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CELESTE } };
    ws.getCell(row, i).border = BORDER_ALL;
  }
  ['XXS (2/3)', 'XS (4/5)', 'S (6/7)', 'M (8/9)', 'L (10/11)', 'XL (12/13)', 'XXL (14/15)', 'XXXL (16)', '', '', ''].forEach((h, i) => {
    ws.getCell(row, 6 + i).value = h;
    ws.getCell(row, 6 + i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CELESTE } };
    ws.getCell(row, 6 + i).border = BORDER_ALL;
    ws.getCell(row, 6 + i).alignment = { horizontal: 'center' };
    ws.getCell(row, 6 + i).font = { size: 9 };
  });
  ws.getCell(row, 17).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CELESTE } };
  ws.getCell(row, 17).border = BORDER_ALL;
  row++;

  // Helper to get size value with fallbacks
  const getSizeValue = (sizes, ...keys) => {
    if (!sizes) return '';
    for (const key of keys) {
      if (sizes[key] !== undefined && sizes[key] !== null && sizes[key] !== '') {
        return sizes[key];
      }
    }
    return '';
  };

  // Qty data
  (sw.quantity_lines || []).forEach(line => {
    const sizes = line.sizes || {};
    const isSub = (line.type || '').toLowerCase() === 'subtotal';
    const isGrand = (line.type || '').toLowerCase() === 'grandtotal';
    
    ws.getCell(row, 1).value = isSub ? 'SUB TOTAL' : (isGrand ? 'GRAND TOTAL' : (line.style || ''));
    ws.getCell(row, 2).value = line.po || '';
    ws.getCell(row, 3).value = line.xfty || '';
    ws.getCell(row, 4).value = line.color_name || '';
    ws.getCell(row, 5).value = line.color_code || '';
    ws.getCell(row, 6).value = getSizeValue(sizes, 'xxs', 'xxs_2_3', '2_3', '2/3');
    ws.getCell(row, 7).value = getSizeValue(sizes, 'xs', 'xs_4_5', '4_5', '4/5');
    ws.getCell(row, 8).value = getSizeValue(sizes, 's', 's_6_7', '6_7', '6/7');
    ws.getCell(row, 9).value = getSizeValue(sizes, 'm', 'm_8_9', '8_9', '8/9');
    ws.getCell(row, 10).value = getSizeValue(sizes, 'l', 'l_10_11', '10_11', '10/11');
    ws.getCell(row, 11).value = getSizeValue(sizes, 'xl', 'xl_12_13', '12_13', '12/13');
    ws.getCell(row, 12).value = getSizeValue(sizes, 'xxl', 'xxl_14_15', '14_15', '14/15');
    ws.getCell(row, 13).value = getSizeValue(sizes, 'xxxl', 'xxxl_16', '16');
    ws.getCell(row, 14).value = getSizeValue(sizes, '1x');
    ws.getCell(row, 15).value = getSizeValue(sizes, '2x');
    ws.getCell(row, 16).value = getSizeValue(sizes, '3x', '4x');
    ws.getCell(row, 17).value = line.total || '';
    
    for (let c = 1; c <= 17; c++) {
      ws.getCell(row, c).border = BORDER_ALL;
      ws.getCell(row, c).alignment = { horizontal: c > 5 ? 'center' : 'left' };
      if (isSub || isGrand) {
        ws.getCell(row, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CELESTE } };
        ws.getCell(row, c).font = { bold: true };
      }
    }
    row++;
  });

  // Section 5: Cutting Details
  ws.mergeCells(row, 1, row, 17);
  ws.getCell(row, 1).value = '5. CUTTING DETAIL';
  ws.getCell(row, 1).font = { bold: true };
  ws.getCell(row, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CELESTE } };
  applyBorder(ws, 1, 17, row);
  row++;

  (sw.cutting_detail_notes || []).forEach((note, idx) => {
    ws.getCell(row, 1).value = idx + 1;
    ws.getCell(row, 1).border = BORDER_ALL;
    ws.getCell(row, 1).alignment = { horizontal: 'center' };
    ws.mergeCells(row, 2, row, 17);
    ws.getCell(row, 2).value = note;
    applyBorder(ws, 2, 17, row);
    row++;
  });

  // Section 6: Sewing Details
  ws.mergeCells(row, 1, row, 17);
  ws.getCell(row, 1).value = '6. SEWING DETAIL';
  ws.getCell(row, 1).font = { bold: true };
  ws.getCell(row, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CELESTE } };
  applyBorder(ws, 1, 17, row);
  row++;

  ws.mergeCells(row, 1, row, 8);
  ws.getCell(row, 1).value = 'DESIGN';
  ws.getCell(row, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CELESTE } };
  applyBorder(ws, 1, 8, row);
  ws.mergeCells(row, 9, row, 17);
  ws.getCell(row, 9).value = 'SEWING';
  ws.getCell(row, 9).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CELESTE } };
  applyBorder(ws, 9, 17, row);
  row++;

  (sw.sewing_detail_notes || []).forEach((note, idx) => {
    ws.getCell(row, 9).value = idx + 1;
    ws.getCell(row, 9).border = BORDER_ALL;
    ws.getCell(row, 9).alignment = { horizontal: 'center' };
    ws.mergeCells(row, 10, row, 17);
    ws.getCell(row, 10).value = note;
    applyBorder(ws, 10, 17, row);
    row++;
  });

  // Section 7: Measurements
  ws.mergeCells(row, 1, row, 17);
  ws.getCell(row, 1).value = '7. ESPECIFICACION DE MEDIDAS/ MEASUREMENT SPECIFICATION/치수';
  ws.getCell(row, 1).font = { bold: true };
  ws.getCell(row, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CELESTE } };
  applyBorder(ws, 1, 17, row);
  row++;

  ['PUNTOS DE MEDIDA', 'TOL(-/+)', 'XXS (2/3)', 'XS (4/5)', 'S (6/7)', 'M (8/9)', 'L (10/11)', 'XL (12/13)', 'XXL (14/15)', 'XXXL (16)'].forEach((h, i) => {
    ws.getCell(row, i + 1).value = h;
    ws.getCell(row, i + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CELESTE } };
    ws.getCell(row, i + 1).border = BORDER_ALL;
    ws.getCell(row, i + 1).font = { bold: true, size: 9 };
    ws.getCell(row, i + 1).alignment = { horizontal: 'center' };
  });
  row++;

  (sw.measurement_rows || []).forEach(m => {
    ws.getCell(row, 1).value = m.name || '';
    ws.getCell(row, 1).border = BORDER_ALL;
    ws.getCell(row, 2).value = m.tolerance || '';
    ws.getCell(row, 2).border = BORDER_ALL;
    ws.getCell(row, 2).alignment = { horizontal: 'center' };
    
    // Use getSizeValue for measurement rows too
    const measSizes = [
      getSizeValue(m, 'xxs', 'xxs_2_3', '2_3'),
      getSizeValue(m, 'xs', 'xs_4_5', '4_5'),
      getSizeValue(m, 's', 's_6_7', '6_7'),
      getSizeValue(m, 'm', 'm_8_9', '8_9'),
      getSizeValue(m, 'l', 'l_10_11', '10_11'),
      getSizeValue(m, 'xl', 'xl_12_13', '12_13'),
      getSizeValue(m, 'xxl', 'xxl_14_15', '14_15'),
      getSizeValue(m, 'xxxl', 'xxxl_16', '16')
    ];
    
    measSizes.forEach((v, i) => {
      ws.getCell(row, 3 + i).value = v || '';
      ws.getCell(row, 3 + i).border = BORDER_ALL;
      ws.getCell(row, 3 + i).alignment = { horizontal: 'center' };
    });
    row++;
  });

  // Section 8: Labels/Packing
  ws.mergeCells(row, 1, row, 17);
  ws.getCell(row, 1).value = '8. TRIM & PACKING DETAILS';
  ws.getCell(row, 1).font = { bold: true };
  ws.getCell(row, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CELESTE } };
  applyBorder(ws, 1, 17, row);
  row++;

  ws.mergeCells(row, 1, row, 8);
  ws.getCell(row, 1).value = 'ETIQUETAS/ LABELS/라벨';
  ws.getCell(row, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CELESTE } };
  applyBorder(ws, 1, 8, row);
  ws.mergeCells(row, 9, row, 17);
  ws.getCell(row, 9).value = 'ACABADO/ PACKING/완성';
  ws.getCell(row, 9).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CELESTE } };
  applyBorder(ws, 9, 17, row);
  row++;

  if (labelsInfo.folding_size) {
    ws.mergeCells(row, 9, row, 17);
    ws.getCell(row, 9).value = `TAMANO DE FOLDING - ${labelsInfo.folding_size}`;
    ws.getCell(row, 9).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: YELLOW } };
    applyBorder(ws, 9, 17, row);
    row++;
  }

  (sw.trim_packing_notes || []).forEach(note => {
    ws.mergeCells(row, 9, row, 17);
    ws.getCell(row, 9).value = note;
    applyBorder(ws, 9, 17, row);
    row++;
  });

  // Section 9: Important Notes (if any)
  if (sw.important_notes && sw.important_notes.length > 0) {
    row++; // Add spacing
    ws.mergeCells(row, 1, row, 17);
    ws.getCell(row, 1).value = '9. NOTAS IMPORTANTES/ IMPORTANT NOTES/중요 사항';
    ws.getCell(row, 1).font = { bold: true };
    ws.getCell(row, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CELESTE } };
    applyBorder(ws, 1, 17, row);
    row++;

    sw.important_notes.forEach((note, idx) => {
      ws.getCell(row, 1).value = idx + 1;
      ws.getCell(row, 1).border = BORDER_ALL;
      ws.getCell(row, 1).alignment = { horizontal: 'center' };
      ws.mergeCells(row, 2, row, 17);
      ws.getCell(row, 2).value = note;
      ws.getCell(row, 2).alignment = { wrapText: true };
      applyBorder(ws, 2, 17, row);
      row++;
    });
  }

  // Section 10: Yield Info (if any)
  if (sw.yield_info && (sw.yield_info.body || sw.yield_info.rib)) {
    row++; // Add spacing
    ws.mergeCells(row, 1, row, 17);
    ws.getCell(row, 1).value = '10. CONSUMO/ YIELD/요척';
    ws.getCell(row, 1).font = { bold: true };
    ws.getCell(row, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CELESTE } };
    applyBorder(ws, 1, 17, row);
    row++;

    if (sw.yield_info.body) {
      ws.mergeCells(row, 1, row, 3);
      ws.getCell(row, 1).value = 'BODY';
      ws.getCell(row, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CELESTE } };
      applyBorder(ws, 1, 3, row);
      ws.mergeCells(row, 4, row, 8);
      ws.getCell(row, 4).value = `${sw.yield_info.body} ${sw.yield_info.unit || 'YD/DZ'}`;
      applyBorder(ws, 4, 8, row);
      row++;
    }
    if (sw.yield_info.rib) {
      ws.mergeCells(row, 1, row, 3);
      ws.getCell(row, 1).value = 'RIB';
      ws.getCell(row, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CELESTE } };
      applyBorder(ws, 1, 3, row);
      ws.mergeCells(row, 4, row, 8);
      ws.getCell(row, 4).value = `${sw.yield_info.rib} ${sw.yield_info.unit || 'YD/DZ'}`;
      applyBorder(ws, 4, 8, row);
      row++;
    }
  }

  // Additional Tables (if any)
  if (sw.additional_tables && sw.additional_tables.length > 0) {
    sw.additional_tables.forEach((table, tableIdx) => {
      if (!table.headers || !table.rows || table.rows.length === 0) return;
      
      row++; // Add spacing
      ws.mergeCells(row, 1, row, 17);
      ws.getCell(row, 1).value = table.table_name || `Additional Table ${tableIdx + 1}`;
      ws.getCell(row, 1).font = { bold: true };
      ws.getCell(row, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CELESTE } };
      applyBorder(ws, 1, 17, row);
      row++;

      // Headers
      const numCols = Math.min(table.headers.length, 17);
      table.headers.slice(0, numCols).forEach((header, colIdx) => {
        ws.getCell(row, colIdx + 1).value = header;
        ws.getCell(row, colIdx + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CELESTE } };
        ws.getCell(row, colIdx + 1).border = BORDER_ALL;
        ws.getCell(row, colIdx + 1).font = { bold: true };
      });
      row++;

      // Data rows
      table.rows.forEach(dataRow => {
        const rowData = Array.isArray(dataRow) ? dataRow : Object.values(dataRow);
        rowData.slice(0, numCols).forEach((val, colIdx) => {
          ws.getCell(row, colIdx + 1).value = val || '';
          ws.getCell(row, colIdx + 1).border = BORDER_ALL;
        });
        row++;
      });
    });
  }

  return orderInfo.file || 'SewingWorksheet';
}

// Helper function to normalize size values from various formats
function normalizeSizeValue(sizes, sizeKey) {
  if (!sizes) return '';
  
  // Try direct key first
  if (sizes[sizeKey] !== undefined) return sizes[sizeKey];
  
  // Try with underscores
  const underscoreKey = sizeKey.replace(/[^a-z0-9]/gi, '_');
  if (sizes[underscoreKey] !== undefined) return sizes[underscoreKey];
  
  // Try common variations
  const variations = {
    'xxs': ['xxs', 'xxs_2_3', '2_3'],
    'xs': ['xs', 'xs_4_5', '4_5'],
    's': ['s', 's_6_7', '6_7'],
    'm': ['m', 'm_8_9', '8_9'],
    'l': ['l', 'l_10_11', '10_11'],
    'xl': ['xl', 'xl_12_13', '12_13'],
    'xxl': ['xxl', 'xxl_14_15', '14_15'],
    'xxxl': ['xxxl', 'xxxl_16', '16']
  };
  
  const keys = variations[sizeKey.toLowerCase()] || [sizeKey];
  for (const key of keys) {
    if (sizes[key] !== undefined) return sizes[key];
  }
  
  return '';
}

window.exportToExcelSewingWorksheet = exportToExcelSewingWorksheet;
window.normalizeSizeValue = normalizeSizeValue;
