// ════════════════════════════════════════════════════════
//  TradeEdge — Google Apps Script Backend
//  Paste this entire file into your Apps Script project
// ════════════════════════════════════════════════════════

// ── CONFIGURATION ──────────────────────────────────────
// After creating your Google Sheet, paste its ID here.
// The Sheet ID is the long string in the URL:
// https://docs.google.com/spreadsheets/d/  <SHEET_ID>  /edit
const SHEET_ID = 'PASTE_YOUR_SHEET_ID_HERE';

// Your authorised Google account email — only this account can write data.
// You can add more emails to the array if needed.
const AUTHORISED_EMAILS = ['PASTE_YOUR_GMAIL_HERE'];

// ── CORS HEADERS ───────────────────────────────────────
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };
}

// ── AUTH CHECK ─────────────────────────────────────────
function isAuthorised(email) {
  return AUTHORISED_EMAILS.map(e => e.toLowerCase()).includes((email || '').toLowerCase());
}

// ── MAIN ENTRY POINTS ──────────────────────────────────

function doGet(e) {
  try {
    const email = e.parameter.email || '';
    if (!isAuthorised(email)) {
      return buildResponse({ error: 'Unauthorised' }, 403);
    }

    const action = e.parameter.action;

    if (action === 'getAllDays') {
      return buildResponse(getAllDays());
    }

    if (action === 'getDay') {
      const date = e.parameter.date;
      return buildResponse(getDay(date));
    }

    return buildResponse({ error: 'Unknown action' }, 400);
  } catch (err) {
    return buildResponse({ error: err.toString() }, 500);
  }
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const email = payload.email || '';

    if (!isAuthorised(email)) {
      return buildResponse({ error: 'Unauthorised' }, 403);
    }

    const action = payload.action;

    if (action === 'saveTrade') {
      return buildResponse(saveTrade(payload.date, payload.trade));
    }

    if (action === 'deleteTrade') {
      return buildResponse(deleteTrade(payload.date, payload.tradeId));
    }

    if (action === 'markDayComplete') {
      return buildResponse(markDayComplete(payload.date, payload.completed));
    }

    if (action === 'saveFullState') {
      return buildResponse(saveFullState(payload.state));
    }

    return buildResponse({ error: 'Unknown action' }, 400);
  } catch (err) {
    return buildResponse({ error: err.toString() }, 500);
  }
}

// ── DATA OPERATIONS ────────────────────────────────────

function getSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName('TradeData');
  if (!sheet) {
    sheet = ss.insertSheet('TradeData');
    // Write header row
    sheet.getRange(1, 1, 1, 14).setValues([[
      'date', 'tradeId', 'symbol', 'direction', 'timeframe',
      'entry', 'exit', 'qty', 'pnl',
      'check_chart', 'check_buysell', 'check_fvg',
      'flags', 'notes'
    ]]);
    sheet.getRange(1, 1, 1, 14).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getMetaSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName('DayMeta');
  if (!sheet) {
    sheet = ss.insertSheet('DayMeta');
    sheet.getRange(1, 1, 1, 2).setValues([['date', 'completed']]);
    sheet.getRange(1, 1, 1, 2).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getAllDays() {
  const sheet = getSheet();
  const meta = getMetaSheet();

  const data = sheet.getDataRange().getValues();
  const metaData = meta.getDataRange().getValues();

  // Build days map from trade rows
  const days = {};
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const date = row[0];
    if (!date) continue;
    if (!days[date]) days[date] = { trades: [], completed: false };

    days[date].trades.push({
      id: row[1],
      symbol: row[2],
      dir: row[3],
      tf: row[4],
      entry: row[5],
      exit: row[6],
      qty: row[7],
      pnl: row[8],
      checks: [row[9] === true || row[9] === 'TRUE', row[10] === true || row[10] === 'TRUE', row[11] === true || row[11] === 'TRUE'],
      flags: row[12] ? row[12].split('|') : [],
      notes: row[13] || ''
    });
  }

  // Overlay completion status from meta sheet
  for (let i = 1; i < metaData.length; i++) {
    const date = metaData[i][0];
    const completed = metaData[i][1] === true || metaData[i][1] === 'TRUE';
    if (date) {
      if (!days[date]) days[date] = { trades: [], completed: false };
      days[date].completed = completed;
    }
  }

  return { success: true, days };
}

function getDay(date) {
  const all = getAllDays();
  return { success: true, day: all.days[date] || { trades: [], completed: false } };
}

function saveTrade(date, trade) {
  const sheet = getSheet();
  // Check if trade ID already exists (update scenario)
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(date) && String(data[i][1]) === String(trade.id)) {
      // Update existing row
      sheet.getRange(i + 1, 1, 1, 14).setValues([[
        date, trade.id, trade.symbol, trade.dir, trade.tf,
        trade.entry, trade.exit, trade.qty, trade.pnl,
        trade.checks[0], trade.checks[1], trade.checks[2],
        (trade.flags || []).join('|'), trade.notes || ''
      ]]);
      return { success: true, action: 'updated' };
    }
  }
  // Append new row
  sheet.appendRow([
    date, trade.id, trade.symbol, trade.dir, trade.tf,
    trade.entry, trade.exit, trade.qty, trade.pnl,
    trade.checks[0], trade.checks[1], trade.checks[2],
    (trade.flags || []).join('|'), trade.notes || ''
  ]);
  return { success: true, action: 'created' };
}

function deleteTrade(date, tradeId) {
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === String(date) && String(data[i][1]) === String(tradeId)) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { success: false, error: 'Trade not found' };
}

function markDayComplete(date, completed) {
  const meta = getMetaSheet();
  const data = meta.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(date)) {
      meta.getRange(i + 1, 2).setValue(completed);
      return { success: true };
    }
  }
  meta.appendRow([date, completed]);
  return { success: true };
}

// Bulk import — replaces all data (used for first-time migration from localStorage)
function saveFullState(stateObj) {
  const ss = SpreadsheetApp.openById(SHEET_ID);

  // Clear and rebuild TradeData
  let tradeSheet = ss.getSheetByName('TradeData');
  if (tradeSheet) ss.deleteSheet(tradeSheet);
  tradeSheet = ss.insertSheet('TradeData');
  tradeSheet.getRange(1, 1, 1, 14).setValues([[
    'date', 'tradeId', 'symbol', 'direction', 'timeframe',
    'entry', 'exit', 'qty', 'pnl',
    'check_chart', 'check_buysell', 'check_fvg',
    'flags', 'notes'
  ]]);
  tradeSheet.getRange(1, 1, 1, 14).setFontWeight('bold');
  tradeSheet.setFrozenRows(1);

  // Clear and rebuild DayMeta
  let metaSheet = ss.getSheetByName('DayMeta');
  if (metaSheet) ss.deleteSheet(metaSheet);
  metaSheet = ss.insertSheet('DayMeta');
  metaSheet.getRange(1, 1, 1, 2).setValues([['date', 'completed']]);
  metaSheet.getRange(1, 1, 1, 2).setFontWeight('bold');
  metaSheet.setFrozenRows(1);

  const days = stateObj.days || {};
  const tradeRows = [];
  const metaRows = [];

  Object.keys(days).forEach(date => {
    const day = days[date];
    metaRows.push([date, day.completed || false]);
    (day.trades || []).forEach(t => {
      tradeRows.push([
        date, t.id, t.symbol, t.dir, t.tf,
        t.entry, t.exit, t.qty, t.pnl,
        (t.checks||[])[0]||false, (t.checks||[])[1]||false, (t.checks||[])[2]||false,
        (t.flags||[]).join('|'), t.notes||''
      ]);
    });
  });

  if (tradeRows.length) tradeSheet.getRange(2, 1, tradeRows.length, 14).setValues(tradeRows);
  if (metaRows.length) metaSheet.getRange(2, 1, metaRows.length, 2).setValues(metaRows);

  return { success: true, tradesImported: tradeRows.length, daysImported: metaRows.length };
}

// ── HELPER ─────────────────────────────────────────────
function buildResponse(data, statusCode) {
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}
