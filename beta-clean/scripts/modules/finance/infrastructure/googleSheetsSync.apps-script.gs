var GOOGLE_SHEETS_TOKEN = 'MiTokenSuperSecreto123456';
var TICKET_SYNC_PROPERTY_PREFIX = 'bookshell.finance.ticketSync.';
var REGISTRY_SHEET_NAME = 'Registro Productos';
var REGISTRY_HEADER_SCAN_ROWS = 6;
var STORE_BLOCK_WIDTH = 5;
var STORE_COLS = {
  COOP: 27,
};
var STORE_COUNTRY_HINTS = {
  COOP: 'CH',
  MIGROS: 'CH',
  DENNER: 'CH',
  MERCADONA: 'ES',
  EROSKI: 'ES',
  'EROSKI CITY': 'ES',
  CARREFOUR: 'ES',
  DIA: 'ES',
  ALCAMPO: 'ES',
  CONSUM: 'ES',
  ALDI: 'ES',
  LIDL: 'ES',
};

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

    var registryResult = syncStructuredRegistryProducts_(payload);
    warnings = warnings.concat(registryResult.warnings || []);

    SpreadsheetApp.flush();
    properties.setProperty(syncPropertyKey, syncStamp);

    return {
      ok: true,
      ticketId: ticket.id,
      movementId: ticket.movementId,
      productCount: payload.products.length,
      productsProcessed: registryResult.processed,
      productsSource: payload.productsSource,
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

  var lineSource = pickLongestObjectArray_([
    { name: 'ticket.lines', items: ticket.lines },
    { name: 'ticket.items', items: ticket.items },
    { name: 'payload.items', items: payload.items },
    { name: 'payload.products', items: payload.products },
    { name: 'ticket.products', items: ticket.products },
  ]);
  var productSource = pickLongestObjectArray_([
    { name: 'payload.products', items: payload.products },
    { name: 'payload.items', items: payload.items },
    { name: 'ticket.products', items: ticket.products },
    { name: 'ticket.items', items: ticket.items },
    { name: lineSource.name, items: lineSource.items },
  ]);
  var lines = lineSource.items;

  if (!lines.length) throw new Error('missing-ticket-lines');

  Logger.log('[ticket.confirm] linesSource=%s lines=%s productsSource=%s products=%s', lineSource.name, lines.length, productSource.name, productSource.items.length);

  return {
    ticket: {
      id: ticketId,
      movementId: movementId,
      txId: String(ticket.txId || movementId).trim(),
      dateISO: normalizeSheetDateValue_(ticket.dateISO || ticket.date || ticket.confirmedAt || payload.confirmedAt || ''),
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
    products: productSource.items,
    productsSource: productSource.name,
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
    dateISO: normalizeSheetDateValue_(ticket.dateISO || ticket.confirmedAt || ''),
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
    date: normalizeSheetDateValue_(ticket.dateISO || ticket.confirmedAt || ''),
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
  var safePrice = resolveProductPriceNumber_(product, 0);
  var safeCurrency = resolveProductCurrencyCode_(product, '');
  var safePriceEur = firstFiniteNumber_([
    product.lastPriceEur,
    product.priceEur,
    product.unitPriceEur,
    product.totalEur,
    product.ticketTotalEur,
  ], 0);
  return {
    id: String(product.id || '').trim(),
    name: resolveProductName_(product),
    categoryName: String(product.categoryName || product.category || '').trim(),
    tipoProducto: resolveProductType_(product),
    pesoValor: resolveProductWeightValue_(product),
    pesoUnidad: resolveProductWeightUnit_(product),
    supermarketName: resolveProductStoreName_(product, {}),
    lastPrice: safePrice,
    lastCurrency: safeCurrency,
    lastPriceEur: safePriceEur,
    purchaseCount: normalizeNumber_(product.purchaseCountDelta || product.purchaseCount || 0, 0),
    totalOriginal: firstFiniteNumber_([product.ticketTotalOriginal, product.totalOriginal, product.totalPrice, product.total], 0),
    totalEur: firstFiniteNumber_([product.ticketTotalEur, product.totalEur], 0),
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
  var warnings = [];
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(REGISTRY_SHEET_NAME);
  if (!sheet) return warnings;
  var stores = {};
  (payload.products || []).forEach(function(product) {
    var store = resolveProductStoreName_(product, payload.ticket || {});
    if (!store) return;
    stores[normalizeLookupKey_(store)] = store;
  });
  Object.keys(stores).forEach(function(key) {
    if (!resolveStoreBlockColumns_(sheet, stores[key], payload.ticket || {})) {
      warnings.push('missing-store-block:' + stores[key]);
    }
  });
  if (!Object.keys(stores).length && payload.ticket && payload.ticket.supermarketName) {
    if (!resolveStoreBlockColumns_(sheet, payload.ticket.supermarketName, payload.ticket || {})) {
      warnings.push('missing-store-block:' + payload.ticket.supermarketName);
    }
  }
  return warnings;
}

function ensureStructuredCategoryVisibilityContract_(payload) {
  return [];
}

function syncStructuredRegistryProducts_(payload) {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName(REGISTRY_SHEET_NAME);
  var warnings = [];

  if (!sheet) {
    warnings.push('missing-sheet:' + REGISTRY_SHEET_NAME);
    return { processed: 0, warnings: warnings };
  }

  var processed = 0;
  var registryMeta = buildRegistrySheetMeta_(sheet);
  (payload.products || []).forEach(function(rawProduct) {
    var product = normalizeRegistryProduct_(rawProduct, payload);
    if (!product.name) {
      warnings.push('registry-product-without-name');
      return;
    }
    if (!product.productType) {
      warnings.push('registry-product-without-type:' + product.name);
      return;
    }
    if (!product.storeName) {
      warnings.push('registry-product-without-store:' + product.name);
      return;
    }

    try {
      var rowIndex = ensureRegistryRowForProductType_(sheet, registryMeta, product.productType);
      writeProductIntoRegistryRow(sheet, rowIndex, product, registryMeta);
      registryMeta = buildRegistrySheetMeta_(sheet);
      processed += 1;
    } catch (error) {
      warnings.push('registry-write-failed:' + product.name + ':' + (error && error.message ? error.message : String(error)));
    }
  });

  Logger.log('[ticket.confirm] structured-registry productsProcessed=%s source=%s', processed, String(payload.productsSource || 'unknown'));
  return { processed: processed, warnings: warnings };
}

function buildRegistrySheetMeta_(sheet) {
  var lastRow = Math.max(sheet.getLastRow(), 1);
  var lastColumn = Math.max(sheet.getLastColumn(), 1);
  var columnA = sheet.getRange(1, 1, lastRow, 1).getDisplayValues();
  var sectionRowsByType = {};

  for (var rowIndex = 0; rowIndex < columnA.length; rowIndex += 1) {
    var label = String(columnA[rowIndex][0] || '').trim();
    if (!label) continue;
    var normalizedLabel = normalizeLookupKey_(label);
    if (!sectionRowsByType[normalizedLabel]) {
      sectionRowsByType[normalizedLabel] = rowIndex + 1;
    }
  }

  return {
    lastRow: lastRow,
    lastColumn: lastColumn,
    sectionRowsByType: sectionRowsByType,
    manualInputColumns: getRegistryManualInputColumns_(sheet, lastColumn),
  };
}

function ensureRegistryRowForProductType_(sheet, registryMeta, productType) {
  var normalizedType = normalizeLookupKey_(productType);
  var sectionRow = registryMeta.sectionRowsByType[normalizedType];

  if (!sectionRow) {
    return createRegistrySectionAtEnd_(sheet, registryMeta, productType);
  }

  return insertRegistryProductRowBelowSection_(sheet, registryMeta, sectionRow);
}

function insertRegistryProductRowBelowSection_(sheet, registryMeta, sectionRow) {
  var targetRow = sectionRow + 1;
  sheet.insertRowsBefore(targetRow, 1);
  var sourceRow = targetRow + 1;
  var maxColumns = Math.max(registryMeta.lastColumn, sheet.getLastColumn(), 1);

  if (sourceRow <= sheet.getLastRow()) {
    sheet.getRange(sourceRow, 1, 1, maxColumns).copyTo(sheet.getRange(targetRow, 1, 1, maxColumns));
  }

  clearRegistryManualInputs_(sheet, targetRow, registryMeta.manualInputColumns);
  return targetRow;
}

function createRegistrySectionAtEnd_(sheet, registryMeta, productType) {
  var previousLastRow = Math.max(sheet.getLastRow(), 1);
  sheet.insertRowsAfter(previousLastRow, 2);

  var sectionRow = previousLastRow + 1;
  var templateRow = previousLastRow + 2;
  var maxColumns = Math.max(registryMeta.lastColumn, sheet.getLastColumn(), 1);

  if (previousLastRow >= 1) {
    sheet.getRange(previousLastRow, 1, 1, maxColumns).copyTo(sheet.getRange(templateRow, 1, 1, maxColumns));
  }

  clearRegistryManualInputs_(sheet, templateRow, registryMeta.manualInputColumns);
  sheet.getRange(sectionRow, 1).setValue(String(productType || '').trim());
  ensureRowIsOutsideGroups_(sheet, sectionRow);
  ensureRowIsOutsideGroups_(sheet, templateRow);

  return insertRegistryProductRowBelowSection_(sheet, buildRegistrySheetMeta_(sheet), sectionRow);
}

function clearRegistryManualInputs_(sheet, rowIndex, manualInputColumns) {
  var uniqueCols = {};
  var columns = Array.isArray(manualInputColumns) ? manualInputColumns : [];

  columns.forEach(function(col) {
    var safeCol = Number(col || 0);
    if (!safeCol || uniqueCols[safeCol]) return;
    uniqueCols[safeCol] = true;
    sheet.getRange(rowIndex, safeCol).clearContent();
  });
}

function getRegistryManualInputColumns_(sheet, lastColumn) {
  var columns = [1];
  var found = {};
  var maxRow = Math.min(REGISTRY_HEADER_SCAN_ROWS, Math.max(sheet.getLastRow(), 1));
  var headers = sheet.getRange(1, 1, maxRow, lastColumn).getDisplayValues();

  for (var rowIndex = 0; rowIndex < headers.length; rowIndex += 1) {
    for (var colIndex = 0; colIndex < headers[rowIndex].length; colIndex += 1) {
      var normalized = normalizeLookupKey_(headers[rowIndex][colIndex]);
      if (!normalized) continue;
      if (normalized === 'CHF' || normalized === 'EUR' || normalized === 'PESO') {
        found[colIndex + 1] = true;
      }
    }
  }

  Object.keys(STORE_COLS).forEach(function(storeKey) {
    var baseCol = Number(STORE_COLS[storeKey] || 0);
    if (!baseCol) return;
    found[baseCol] = true;
    found[baseCol + 1] = true;
    found[baseCol + 4] = true;
  });

  Object.keys(found).forEach(function(colKey) {
    var col = Number(colKey || 0);
    if (col > 0 && col <= lastColumn && columns.indexOf(col) === -1) {
      columns.push(col);
    }
  });

  return columns.sort(function(a, b) { return a - b; });
}

function writeProductIntoRegistryRow(sheet, rowIndex, product, registryMeta) {
  var storeBlock = resolveStoreBlockColumns_(sheet, product.storeName, product);
  if (!storeBlock) {
    throw new Error('missing-store-block:' + product.storeName);
  }

  sheet.getRange(rowIndex, 1).setValue(product.name);

  if (product.price !== '' && product.currency === 'CHF' && storeBlock.chfCol) {
    sheet.getRange(rowIndex, storeBlock.chfCol).setValue(product.price);
  } else if (product.price !== '' && storeBlock.country === 'ES' && storeBlock.eurCol) {
    sheet.getRange(rowIndex, storeBlock.eurCol).setValue(product.price);
  }

  if (storeBlock.pesoCol && product.weightValue !== '') {
    sheet.getRange(rowIndex, storeBlock.pesoCol).setValue(product.weightValue);
  }
}

function resolveStoreBlockColumns_(sheet, storeName, context) {
  var normalizedStore = normalizeLookupKey_(storeName);
  if (!normalizedStore) return null;

  var lastColumn = Math.max(sheet.getLastColumn(), 1);
  var maxRow = Math.min(REGISTRY_HEADER_SCAN_ROWS, Math.max(sheet.getLastRow(), 1));
  var headers = sheet.getRange(1, 1, maxRow, lastColumn).getDisplayValues();
  var headerMatch = null;

  for (var rowIndex = 0; rowIndex < headers.length && !headerMatch; rowIndex += 1) {
    for (var colIndex = 0; colIndex < headers[rowIndex].length; colIndex += 1) {
      if (normalizeLookupKey_(headers[rowIndex][colIndex]) === normalizedStore) {
        headerMatch = { row: rowIndex + 1, col: colIndex + 1 };
        break;
      }
    }
  }

  var baseCol = headerMatch ? headerMatch.col : Number(STORE_COLS[normalizedStore] || 0);
  if (!baseCol) return null;

  var block = {
    baseCol: baseCol,
    chfCol: baseCol,
    eurCol: baseCol + 1,
    pesoCol: baseCol + 4,
    country: detectStoreCountry_(sheet, normalizedStore, headerMatch, context),
  };

  var scanStartRow = headerMatch ? headerMatch.row : 1;
  var scanEndRow = Math.min(scanStartRow + 2, maxRow);
  var scanStartCol = Math.max(1, baseCol);
  var scanEndCol = Math.min(lastColumn, baseCol + STORE_BLOCK_WIDTH - 1);

  for (var scanRow = scanStartRow; scanRow <= scanEndRow; scanRow += 1) {
    for (var scanCol = scanStartCol; scanCol <= scanEndCol; scanCol += 1) {
      var normalizedHeader = normalizeLookupKey_(sheet.getRange(scanRow, scanCol).getDisplayValue());
      if (normalizedHeader === 'CHF') block.chfCol = scanCol;
      if (normalizedHeader === 'EUR') block.eurCol = scanCol;
      if (normalizedHeader === 'PESO') block.pesoCol = scanCol;
    }
  }

  return block;
}

function detectStoreCountry_(sheet, normalizedStore, headerMatch, context) {
  if (STORE_COUNTRY_HINTS[normalizedStore]) return STORE_COUNTRY_HINTS[normalizedStore];
  if (String(context && context.currency || '').trim().toUpperCase() === 'CHF') return 'CH';

  if (headerMatch) {
    var lastColumn = Math.max(sheet.getLastColumn(), 1);
    var scanStartRow = 1;
    var scanEndRow = Math.min(headerMatch.row + 1, REGISTRY_HEADER_SCAN_ROWS);
    var scanStartCol = Math.max(1, headerMatch.col - 1);
    var scanEndCol = Math.min(lastColumn, headerMatch.col + STORE_BLOCK_WIDTH - 1);
    var values = sheet.getRange(scanStartRow, scanStartCol, scanEndRow - scanStartRow + 1, scanEndCol - scanStartCol + 1).getDisplayValues();

    for (var rowIndex = 0; rowIndex < values.length; rowIndex += 1) {
      for (var colIndex = 0; colIndex < values[rowIndex].length; colIndex += 1) {
        var normalized = normalizeLookupKey_(values[rowIndex][colIndex]);
        if (normalized === 'ESPANA' || normalized === 'SPAIN') return 'ES';
        if (normalized === 'SUIZA' || normalized === 'SWITZERLAND' || normalized === 'SCHWEIZ') return 'CH';
      }
    }
  }

  if (String(context && context.currency || '').trim().toUpperCase() === 'EUR') return 'ES';
  return '';
}

function normalizeRegistryProduct_(rawProduct, payload) {
  var ticket = payload.ticket || {};
  return {
    name: resolveProductName_(rawProduct),
    productType: resolveProductType_(rawProduct),
    storeName: resolveProductStoreName_(rawProduct, ticket),
    currency: resolveProductCurrencyCode_(rawProduct, ticket.currency || payload.currency || ''),
    price: firstFiniteNumberOrBlank_([
      rawProduct && rawProduct.lastPrice,
      rawProduct && rawProduct.unitPrice,
      rawProduct && rawProduct.price,
      rawProduct && rawProduct.actualPrice,
      rawProduct && rawProduct.totalOriginal,
      rawProduct && rawProduct.ticketTotalOriginal,
      rawProduct && rawProduct.totalPrice,
      rawProduct && rawProduct.total,
    ]),
    weightValue: resolveRegistryWeightValue_(rawProduct),
  };
}

function resolveProductName_(product) {
  return String(product && (product.name || product.product || product.title || product.label) || '').trim();
}

function resolveProductType_(product) {
  return String(product && (product.tipoProducto || product.productType || product.categoryName || product.category || product.type) || '').trim();
}

function resolveProductStoreName_(product, ticket) {
  return String(product && (product.supermarketName || product.supermarket || product.store || product.place) || ticket.supermarketName || '').trim();
}

function resolveProductCurrencyCode_(product, fallback) {
  return String(product && (product.lastCurrency || product.currency || product.currencyOriginal) || fallback || '').trim().toUpperCase();
}

function resolveProductPriceNumber_(product, fallback) {
  return firstFiniteNumber_([
    product && product.lastPrice,
    product && product.unitPrice,
    product && product.price,
    product && product.actualPrice,
    product && product.totalOriginal,
    product && product.ticketTotalOriginal,
    product && product.totalPrice,
    product && product.total,
  ], fallback);
}

function resolveProductWeightValue_(product) {
  return firstFiniteNumber_([
    product && product.pesoValor,
    product && product.weightValue,
    product && product.weight,
  ], 0);
}

function resolveProductWeightUnit_(product) {
  return String(product && (product.pesoUnidad || product.weightUnit || product.unitWeight) || '').trim();
}

function resolveRegistryWeightValue_(product) {
  var value = resolveProductWeightValue_(product);
  var unit = normalizeLookupKey_(resolveProductWeightUnit_(product));
  if (!Number.isFinite(value) || value <= 0) return '';
  if (unit === 'KG') return value * 1000;
  if (unit === 'MG') return value / 1000;
  if (unit === 'L') return value * 1000;
  if (unit === 'CL') return value * 10;
  return value;
}

function ensureRowIsOutsideGroups_(sheet, rowIndex) {
  if (!sheet || typeof sheet.getRowGroupDepth !== 'function') return;
  var attempts = 8;
  while (attempts > 0 && sheet.getRowGroupDepth(rowIndex) > 0) {
    try {
      sheet.getRange(rowIndex, 1, 1, Math.max(sheet.getLastColumn(), 1)).shiftRowGroupDepth(-1);
    } catch (error) {
      break;
    }
    attempts -= 1;
  }
}

function pickLongestObjectArray_(candidates) {
  var best = { name: '', items: [] };
  (candidates || []).forEach(function(candidate) {
    var normalizedItems = normalizeObjectArrayCandidate_(candidate && candidate.items);
    if (normalizedItems.length > best.items.length) {
      best = {
        name: String(candidate && candidate.name || '').trim(),
        items: normalizedItems,
      };
    }
  });
  return best;
}

function normalizeObjectArrayCandidate_(value) {
  var list = Array.isArray(value)
    ? value
    : (value && typeof value === 'object' ? Object.values(value) : []);
  return list.filter(function(item) {
    return item && typeof item === 'object';
  });
}

function firstFiniteNumber_(values, fallback) {
  var list = Array.isArray(values) ? values : [values];
  for (var index = 0; index < list.length; index += 1) {
    var numeric = Number(list[index]);
    if (Number.isFinite(numeric)) return numeric;
  }
  return Number(fallback || 0);
}

function firstFiniteNumberOrBlank_(values) {
  var list = Array.isArray(values) ? values : [values];
  for (var index = 0; index < list.length; index += 1) {
    var numeric = Number(list[index]);
    if (Number.isFinite(numeric)) return numeric;
  }
  return '';
}

function normalizeLookupKey_(value) {
  return String(value || '')
    .trim()
    .replace(/€/g, 'EUR')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
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
    return normalizeSheetCellValue_(column, data[column]);
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

function normalizeSheetCellValue_(column, value) {
  if (column === 'date' || column === 'dateISO') {
    return normalizeSheetDateValue_(value, '');
  }
  return normalizeCellValue(value);
}

function normalizeSheetDateValue_(value, fallback) {
  if (value == null || value === '') return String(fallback || '').trim();
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return formatSheetDateFromTs_(value.getTime());
  }
  var raw = String(value || '').trim();
  if (!raw) return String(fallback || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}[T\s].*$/.test(raw)) return raw.slice(0, 10);
  if (/^\d+(\.\d+)?$/.test(raw)) {
    var numeric = Number(raw);
    if (Number.isFinite(numeric) && numeric > 0) {
      return formatSheetDateFromTs_(numeric < 100000000000 ? numeric * 1000 : numeric);
    }
  }
  var slash = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (slash) {
    var day = Number(slash[1]);
    var month = Number(slash[2]);
    var year = Number(slash[3]);
    if (day > 0 && month > 0 && month <= 12 && year > 0 && day <= 31) {
      return year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    }
  }
  var parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) return formatSheetDateFromTs_(parsed.getTime());
  return String(fallback || raw).trim();
}

function formatSheetDateFromTs_(ts) {
  var numeric = Number(ts);
  if (!Number.isFinite(numeric) || numeric <= 0) return '';
  return Utilities.formatDate(new Date(numeric), Session.getScriptTimeZone(), 'yyyy-MM-dd');
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
