/**
 * CONTRATO ACTUALIZADO DEL WEB APP DE GOOGLE SHEETS
 *
 * Importante:
 * - Este archivo del repo prepara el contrato nuevo `ticket.confirm`.
 * - El Apps Script desplegado que maneja la hoja estructurada real no esta versionado aqui.
 * - La logica avanzada de bloques de supermercado, zona Suiza y recreacion de grupos
 *   debe pegarse y adaptarse en el script desplegado real antes de entrar en produccion.
 * - Mientras tanto, este script deja implementados:
 *   1. recepcion atomica del ticket completo,
 *   2. lock global con LockService,
 *   3. idempotencia por ticket,
 *   4. escritura consolidada en una sola ejecucion,
 *   5. puntos de extension claros para la hoja estructurada.
 */

var GOOGLE_SHEETS_TOKEN = 'MiTokenSuperSecreto123456';
var TICKET_SYNC_PROPERTY_PREFIX = 'bookshell.finance.ticketSync.';

var ENTITY_CONFIG = {
  movement: {
    sheetName: 'Movimientos',
    keyColumns: ['id'],
    columns: ['id', 'date', 'accountName', 'supermarketName', 'categoryName', 'title', 'note', 'amountOriginal', 'currencyOriginal', 'amountEur', 'type', 'productId', 'ticketId'],
  },
  product: {
    sheetName: 'Productos',
    keyColumns: ['id'],
    columns: ['id', 'name', 'categoryName', 'tipoProducto', 'pesoValor', 'pesoUnidad', 'supermarketName', 'lastPrice', 'lastCurrency', 'lastPriceEur', 'purchaseCount', 'totalOriginal', 'totalEur', 'updatedAt'],
  },
  account: {
    sheetName: 'Cuentas',
    keyColumns: ['id'],
    columns: ['id', 'name', 'type', 'balance', 'currency', 'balanceEur', 'updatedAt'],
  },
  productSummary: {
    sheetName: 'ResumenProductos',
    keyColumns: ['product', 'supermarketName'],
    columns: ['product', 'supermarketName', 'purchaseCount', 'lastPrice', 'lastCurrency', 'totalOriginal', 'totalEur'],
  },
  ticketLog: {
    sheetName: 'TicketsSync',
    keyColumns: ['ticketId'],
    columns: ['ticketId', 'movementId', 'confirmedAt', 'dateISO', 'accountId', 'accountName', 'supermarketName', 'currency', 'totalOriginal', 'totalEur', 'amountDebited', 'categoryId', 'paymentMethod', 'lineCount', 'updatedAt'],
  },
};

function doPost(e) {
  try {
    var rawBody = (e && e.postData && e.postData.contents) || '{}';
    var payload = JSON.parse(rawBody);
    var token = String(payload.token || '').trim();

    if (token !== GOOGLE_SHEETS_TOKEN) {
      return jsonOutput({ ok: false, error: 'invalid-token' });
    }

    var entity = String(payload.entity || '').trim();
    var action = String(payload.action || '').trim();

    if (entity === 'ticket' && action === 'confirm') {
      return jsonOutput(handleTicketConfirm_(payload.data || {}));
    }

    var data = payload.data || {};
    var config = ENTITY_CONFIG[entity];

    if (!config) {
      return jsonOutput({ ok: false, error: 'invalid-entity' });
    }

    var sheet = getSheetForEntity(config.sheetName, config.columns);

    if (action === 'create') {
      upsertEntityRow(sheet, config, data, true);
      return jsonOutput({ ok: true });
    }

    if (action === 'update') {
      upsertEntityRow(sheet, config, data, false);
      return jsonOutput({ ok: true });
    }

    if (action === 'delete') {
      deleteEntityRow(sheet, config, data);
      return jsonOutput({ ok: true });
    }

    return jsonOutput({ ok: false, error: 'invalid-action' });
  } catch (error) {
    return jsonOutput({
      ok: false,
      error: error && error.message ? error.message : String(error),
    });
  }
}

function handleTicketConfirm_(rawData) {
  var lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    var payload = normalizeTicketSyncPayload_(rawData);
    var ticket = payload.ticket;
    var syncStamp = buildTicketSyncStamp_(ticket);
    var syncPropertyKey = TICKET_SYNC_PROPERTY_PREFIX + ticket.id;
    var properties = PropertiesService.getDocumentProperties();
    var previousStamp = String(properties.getProperty(syncPropertyKey) || '');

    if (previousStamp && previousStamp === syncStamp) {
      return {
        ok: true,
        deduped: true,
        ticketId: ticket.id,
        movementId: ticket.movementId,
      };
    }

    var movementSheet = getSheetForEntity(ENTITY_CONFIG.movement.sheetName, ENTITY_CONFIG.movement.columns);
    var productSheet = getSheetForEntity(ENTITY_CONFIG.product.sheetName, ENTITY_CONFIG.product.columns);
    var summarySheet = getSheetForEntity(ENTITY_CONFIG.productSummary.sheetName, ENTITY_CONFIG.productSummary.columns);
    var ticketLogSheet = getSheetForEntity(ENTITY_CONFIG.ticketLog.sheetName, ENTITY_CONFIG.ticketLog.columns);

    var warnings = [];
    warnings = warnings.concat(ensureStructuredSupermarketBlockContract_(payload));
    warnings = warnings.concat(ensureStructuredCategoryVisibilityContract_(payload));

    upsertEntityRow(ticketLogSheet, ENTITY_CONFIG.ticketLog, mapTicketLogRow_(ticket), false);
    upsertEntityRow(movementSheet, ENTITY_CONFIG.movement, mapMovementRowFromTicket_(ticket), false);

    payload.products.forEach(function(product) {
      upsertEntityRow(productSheet, ENTITY_CONFIG.product, mapProductRowFromTicket_(product), false);
    });

    payload.summaries.forEach(function(summary) {
      upsertEntityRow(summarySheet, ENTITY_CONFIG.productSummary, mapSummaryRowFromTicket_(summary), false);
    });

    SpreadsheetApp.flush();
    properties.setProperty(syncPropertyKey, syncStamp);

    return {
      ok: true,
      ticketId: ticket.id,
      movementId: ticket.movementId,
      productCount: payload.products.length,
      summaryCount: payload.summaries.length,
      warnings: warnings,
    };
  } finally {
    lock.releaseLock();
  }
}

function normalizeTicketSyncPayload_(rawData) {
  var payload = rawData && typeof rawData === 'object' ? rawData : {};
  var ticket = payload.ticket && typeof payload.ticket === 'object' ? payload.ticket : {};
  var ticketId = String(ticket.id || ticket.ticketId || '').trim();
  var movementId = String(ticket.movementId || ticket.txId || '').trim();

  if (!ticketId) throw new Error('missing-ticket-id');
  if (!movementId) throw new Error('missing-movement-id');

  var lines = Array.isArray(ticket.lines) ? ticket.lines.filter(function(line) {
    return line && typeof line === 'object';
  }) : [];

  if (!lines.length) throw new Error('missing-ticket-lines');

  return {
    ticket: {
      id: ticketId,
      movementId: movementId,
      txId: String(ticket.txId || movementId).trim(),
      dateISO: String(ticket.dateISO || '').trim(),
      confirmedAt: normalizeNumber_(ticket.confirmedAt, 0),
      accountId: String(ticket.accountId || '').trim(),
      accountName: String(ticket.accountName || '').trim(),
      supermarketName: String(ticket.supermarketName || payload.supermarket || '').trim(),
      currency: String(ticket.currency || payload.currency || '').trim(),
      inputCurrency: String(ticket.inputCurrency || ticket.currency || payload.currency || '').trim(),
      accountCurrency: String(ticket.accountCurrency || '').trim(),
      totalOriginal: normalizeNumber_(ticket.totalOriginal, 0),
      totalEur: normalizeNumber_(ticket.totalEur, 0),
      amountDebited: normalizeNumber_(ticket.amountDebited, 0),
      categoryId: String(ticket.categoryId || '').trim(),
      paymentMethod: String(ticket.paymentMethod || '').trim(),
      note: String(ticket.note || '').trim(),
      lines: lines,
    },
    products: Array.isArray(payload.products) ? payload.products.filter(function(product) {
      return product && typeof product === 'object';
    }) : [],
    summaries: Array.isArray(payload.summaries) ? payload.summaries.filter(function(summary) {
      return summary && typeof summary === 'object';
    }) : [],
    supermarket: String(payload.supermarket || ticket.supermarketName || '').trim(),
    currency: String(payload.currency || ticket.currency || '').trim(),
    confirmedAt: normalizeNumber_(payload.confirmedAt || ticket.confirmedAt, 0),
  };
}

function buildTicketSyncStamp_(ticket) {
  return [
    String(ticket.id || '').trim(),
    String(ticket.movementId || ticket.txId || '').trim(),
    String(ticket.confirmedAt || '').trim(),
    String(ticket.totalOriginal || '').trim(),
    String(ticket.totalEur || '').trim(),
  ].join('|');
}

function mapTicketLogRow_(ticket) {
  return {
    ticketId: String(ticket.id || '').trim(),
    movementId: String(ticket.movementId || ticket.txId || '').trim(),
    confirmedAt: normalizeCellValue(ticket.confirmedAt),
    dateISO: String(ticket.dateISO || '').trim(),
    accountId: String(ticket.accountId || '').trim(),
    accountName: String(ticket.accountName || '').trim(),
    supermarketName: String(ticket.supermarketName || '').trim(),
    currency: String(ticket.currency || '').trim(),
    totalOriginal: normalizeNumber_(ticket.totalOriginal, 0),
    totalEur: normalizeNumber_(ticket.totalEur, 0),
    amountDebited: normalizeNumber_(ticket.amountDebited, 0),
    categoryId: String(ticket.categoryId || '').trim(),
    paymentMethod: String(ticket.paymentMethod || '').trim(),
    lineCount: Array.isArray(ticket.lines) ? ticket.lines.length : 0,
    updatedAt: new Date().toISOString(),
  };
}

function mapMovementRowFromTicket_(ticket) {
  var firstLine = Array.isArray(ticket.lines) && ticket.lines.length ? ticket.lines[0] : {};
  return {
    id: String(ticket.movementId || ticket.txId || '').trim(),
    date: String(ticket.dateISO || '').trim(),
    accountName: String(ticket.accountName || '').trim(),
    supermarketName: String(ticket.supermarketName || '').trim(),
    categoryName: String(ticket.categoryId || '').trim(),
    title: 'Compra',
    note: String(ticket.note || '').trim(),
    amountOriginal: normalizeNumber_(ticket.totalOriginal, 0),
    currencyOriginal: String(ticket.inputCurrency || ticket.currency || '').trim(),
    amountEur: normalizeNumber_(ticket.totalEur, 0),
    type: 'expense',
    productId: String(firstLine.productId || '').trim(),
    ticketId: String(ticket.id || '').trim(),
  };
}

function mapProductRowFromTicket_(product) {
  return {
    id: String(product.id || '').trim(),
    name: String(product.name || '').trim(),
    categoryName: String(product.categoryName || '').trim(),
    tipoProducto: String(product.tipoProducto || '').trim(),
    pesoValor: normalizeNumber_(product.pesoValor, 0),
    pesoUnidad: String(product.pesoUnidad || '').trim(),
    supermarketName: String(product.supermarketName || '').trim(),
    lastPrice: normalizeNumber_(product.lastPrice, 0),
    lastCurrency: String(product.lastCurrency || '').trim(),
    lastPriceEur: normalizeNumber_(product.lastPriceEur, 0),
    purchaseCount: normalizeNumber_(product.purchaseCountDelta || product.purchaseCount || 0, 0),
    totalOriginal: normalizeNumber_(product.ticketTotalOriginal || product.totalOriginal || 0, 0),
    totalEur: normalizeNumber_(product.ticketTotalEur || product.totalEur || 0, 0),
    updatedAt: String(product.updatedAt || new Date().toISOString()).trim(),
  };
}

function mapSummaryRowFromTicket_(summary) {
  return {
    product: String(summary.product || summary.productId || '').trim(),
    supermarketName: String(summary.supermarketName || '').trim(),
    purchaseCount: normalizeNumber_(summary.purchaseCount, 0),
    lastPrice: normalizeNumber_(summary.lastPrice, 0),
    lastCurrency: String(summary.lastCurrency || '').trim(),
    totalOriginal: normalizeNumber_(summary.totalOriginal, 0),
    totalEur: normalizeNumber_(summary.totalEur, 0),
  };
}

function ensureStructuredSupermarketBlockContract_(payload) {
  var ticket = payload.ticket || {};
  var warnings = [];

  /**
   * TODO en el script desplegado real:
   * - detectar supermercado ausente en la hoja estructurada,
   * - usar CHF => zona Suiza,
   * - clonar bloque plantilla completo (formulas, formatos, validaciones, colores, anchos),
   * - adaptar formulas a las columnas nuevas,
   * - incluir el nuevo bloque en medias, comparativas y calculos globales.
   *
   * El repo no contiene la estructura real de esa hoja, por eso aqui solo dejamos
   * el contrato preparado y una advertencia visible.
   */
  if (ticket.supermarketName) {
    warnings.push('structured-supermarket-block-pending-deployed-script');
  }
  return warnings;
}

function ensureStructuredCategoryVisibilityContract_(payload) {
  var ticket = payload.ticket || {};
  var warnings = [];

  /**
   * TODO en el script desplegado real:
   * - insertar categorias nuevas fuera de grupos colapsables existentes,
   * - recrear o ampliar grupos despues de la insercion,
   * - garantizar que la fila nueva quede visible inmediatamente.
   *
   * Sin la hoja estructurada real no es seguro automatizar esta parte desde el repo.
   */
  if (Array.isArray(ticket.lines) && ticket.lines.length) {
    warnings.push('structured-category-groups-pending-deployed-script');
  }
  return warnings;
}

function getSheetForEntity(sheetName, columns) {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
  }
  ensureSheetHeaders_(sheet, columns);
  return sheet;
}

function ensureSheetHeaders_(sheet, columns) {
  if (!sheet || !Array.isArray(columns) || !columns.length) return;
  if (sheet.getMaxColumns() < columns.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), columns.length - sheet.getMaxColumns());
  }
  var currentHeader = sheet.getRange(1, 1, 1, columns.length).getValues()[0];
  var needsHeader = !currentHeader.some(function(value) { return String(value || '').trim(); });
  if (needsHeader) {
    sheet.getRange(1, 1, 1, columns.length).setValues([columns]);
    sheet.setFrozenRows(1);
  }
}

function upsertEntityRow(sheet, config, data, insertAtTop) {
  var row = config.columns.map(function(column) {
    return normalizeCellValue(data[column]);
  });

  var existingRow = findRowByKey(sheet, config, data);
  if (existingRow > 0) {
    sheet.getRange(existingRow, 1, 1, row.length).setValues([row]);
    return;
  }

  var targetRow = 2;
  if (sheet.getLastRow() < 1) {
    ensureSheetHeaders_(sheet, config.columns);
  }
  sheet.insertRowBefore(targetRow);
  sheet.getRange(targetRow, 1, 1, row.length).setValues([row]);
}

function deleteEntityRow(sheet, config, data) {
  var rowIndex = findRowByKey(sheet, config, data);
  if (rowIndex > 0) {
    sheet.deleteRow(rowIndex);
  }
}

function findRowByKey(sheet, config, data) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;

  var keyColumns = config.keyColumns || [];
  var values = sheet.getRange(2, 1, lastRow - 1, config.columns.length).getValues();

  for (var rowIndex = 0; rowIndex < values.length; rowIndex += 1) {
    var row = values[rowIndex];
    var matches = keyColumns.every(function(keyColumn) {
      var columnIndex = config.columns.indexOf(keyColumn);
      var rowValue = columnIndex >= 0 ? row[columnIndex] : '';
      return String(rowValue || '').trim() === String(data[keyColumn] || '').trim();
    });

    if (matches) {
      return rowIndex + 2;
    }
  }

  return -1;
}

function normalizeNumber_(value, fallback) {
  var numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number(fallback || 0);
}

function normalizeCellValue(value) {
  if (value == null) return '';
  if (typeof value === 'number') return value;
  return String(value);
}

function jsonOutput(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
