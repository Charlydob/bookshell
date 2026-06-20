var GOOGLE_SHEETS_TOKEN = 'MiTokenSuperSecreto123456';

var ENTITY_CONFIG = {
  movement: {
    sheetName: 'Movimientos',
    keyColumns: ['id'],
    columns: ['id', 'date', 'accountName', 'supermarketName', 'categoryName', 'title', 'note', 'amountOriginal', 'currencyOriginal', 'amountEur', 'type', 'productId', 'ticketId'],
  },
  product: {
    sheetName: 'Productos',
    keyColumns: ['id'],
    columns: ['id', 'name', 'categoryName', 'supermarketName', 'lastPrice', 'lastCurrency', 'lastPriceEur', 'purchaseCount', 'totalOriginal', 'totalEur', 'updatedAt'],
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
    var data = payload.data || {};
    var config = ENTITY_CONFIG[entity];

    if (!config) {
      return jsonOutput({ ok: false, error: 'invalid-entity' });
    }

    var sheet = getSheetForEntity(config.sheetName);

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

function getSheetForEntity(sheetName) {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
  }
  return sheet;
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

  if (!insertAtTop) {
    sheet.insertRowBefore(2);
    sheet.getRange(2, 1, 1, row.length).setValues([row]);
    return;
  }

  sheet.insertRowBefore(2);
  sheet.getRange(2, 1, 1, row.length).setValues([row]);
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
