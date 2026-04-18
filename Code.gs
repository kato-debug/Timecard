// ============================================================
// TimeCard App - Google Apps Script Backend
// ============================================================

const SPREADSHEET_ID = '1vfIh9KBWVE-bwwKJuCmoO2t6P8NKPEmTGgQWqwpLIZI'; // ← デプロイ後にスプレッドシートIDを設定
const SHEET_MASTER   = 'master';
const SHEET_LOG      = 'log';
const SHEET_SUMMARY  = 'summary';

const STANDARD_WORK_MINUTES = 8 * 60;   // 480分
const BREAK_MINUTES          = 60;        // 休憩1時間
const LATE_NIGHT_HOUR        = 22;        // 深夜開始時刻

// ============================================================
// エントリポイント
// ============================================================

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  const callback = e.parameter.callback || null;
  try {
    const action = e.parameter.action || (e.postData ? JSON.parse(e.postData.contents).action : null);
    const params = e.postData ? JSON.parse(e.postData.contents) : e.parameter;

    let result;
    switch (action) {
      case 'authenticate':   result = authenticate(params);        break;
      case 'clockIn':        result = recordAttendance(params, '出勤');   break;
      case 'clockOut':       result = recordAttendance(params, '退勤');   break;
      case 'directStart':    result = recordAttendance(params, '直行');   break;
      case 'directEnd':      result = recordAttendance(params, '直帰');   break;
      case 'getTodayLog':    result = getTodayLog(params);         break;
      case 'getMonthlySummary': result = getMonthlySummary(params); break;
      case 'getMonthlyLogs': result = getMonthlyLogs(params);      break;
      case 'logout':         result = { success: true };           break;
      default:               result = { success: false, error: '不明なアクション: ' + action };
    }

    return buildResponse(result, callback);
  } catch (err) {
    return buildResponse({ success: false, error: err.message }, callback);
  }
}

function buildResponse(data, callback) {
  const json = JSON.stringify(data);
  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// スプレッドシート取得ヘルパー
// ============================================================

function getSpreadsheet() {
  return SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
}

function getSheet(name) {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    initializeSheet(sheet, name);
  }
  return sheet;
}

function initializeSheet(sheet, name) {
  if (name === SHEET_MASTER) {
    sheet.appendRow(['id', 'employee_id', 'name', 'email', 'department', 'created_at', 'is_active']);
  } else if (name === SHEET_LOG) {
    sheet.appendRow(['id', 'employee_id', 'name', 'date', 'type', 'timestamp', 'latitude', 'longitude', 'address']);
  } else if (name === SHEET_SUMMARY) {
    sheet.appendRow(['employee_id', 'name', 'year', 'month', 'work_days', 'total_work_minutes',
      'overtime_minutes', 'late_night_minutes', 'holiday_minutes', 'updated_at']);
  }
}

// ============================================================
// 認証
// ============================================================

function authenticate(params) {
  const email = (params.email || '').toLowerCase().trim();
  if (!email) return { success: false, error: 'メールアドレスが必要です' };

  const sheet = getSheet(SHEET_MASTER);
  const data  = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if ((row[3] || '').toLowerCase().trim() === email && row[6] !== false) {
      return {
        success:     true,
        employee_id: row[1],
        name:        row[2],
        email:       row[3],
        department:  row[4],
      };
    }
  }
  return { success: false, error: 'このメールアドレスは登録されていません' };
}

// ============================================================
// 勤怠記録
// ============================================================

function recordAttendance(params, type) {
  const { employee_id, name, latitude, longitude, address } = params;
  if (!employee_id) return { success: false, error: '社員IDが必要です' };

  const now       = new Date();
  const jstOffset = 9 * 60 * 60 * 1000;
  const jstNow    = new Date(now.getTime() + jstOffset);

  const dateStr = Utilities.formatDate(jstNow, 'Asia/Tokyo', 'yyyy-MM-dd');
  const timeStr = Utilities.formatDate(jstNow, 'Asia/Tokyo', 'HH:mm:ss');

  // 同日同種別の二重打刻チェック（直行・直帰は除く）
  if (type === '出勤' || type === '退勤') {
    const existing = findTodayRecord(employee_id, dateStr, type);
    if (existing) {
      return { success: false, error: `本日の${type}は既に記録されています (${existing})` };
    }
  }

  const sheet = getSheet(SHEET_LOG);
  const id    = Utilities.getUuid();
  sheet.appendRow([id, employee_id, name, dateStr, type, timeStr,
    latitude || '', longitude || '', address || '']);

  // summaryを非同期更新
  updateSummary(employee_id, name, jstNow);

  return {
    success:   true,
    type:      type,
    date:      dateStr,
    time:      timeStr,
    timestamp: jstNow.toISOString(),
  };
}

function findTodayRecord(employee_id, dateStr, type) {
  const sheet = getSheet(SHEET_LOG);
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] == employee_id && data[i][3] === dateStr && data[i][4] === type) {
      return data[i][5]; // 時刻を返す
    }
  }
  return null;
}

// ============================================================
// 今日の記録取得
// ============================================================

function getTodayLog(params) {
  const { employee_id } = params;
  if (!employee_id) return { success: false, error: '社員IDが必要です' };

  const jstNow  = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
  const dateStr = Utilities.formatDate(jstNow, 'Asia/Tokyo', 'yyyy-MM-dd');

  const sheet = getSheet(SHEET_LOG);
  const data  = sheet.getDataRange().getValues();
  const logs  = [];

  for (let i = 1; i < data.length; i++) {
    if (data[i][1] == employee_id && data[i][3] === dateStr) {
      logs.push({
        type:      data[i][4],
        time:      data[i][5],
        latitude:  data[i][6],
        longitude: data[i][7],
        address:   data[i][8],
      });
    }
  }
  return { success: true, date: dateStr, logs: logs };
}

// ============================================================
// 月次ログ取得
// ============================================================

function getMonthlyLogs(params) {
  const { employee_id, year, month } = params;
  if (!employee_id) return { success: false, error: '社員IDが必要です' };

  const y = parseInt(year);
  const m = parseInt(month);
  const sheet = getSheet(SHEET_LOG);
  const data  = sheet.getDataRange().getValues();
  const byDate = {};

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[1] != employee_id) continue;
    const d = row[3]; // 'yyyy-MM-dd'
    if (!d) continue;
    const parts = d.split('-');
    if (parseInt(parts[0]) !== y || parseInt(parts[1]) !== m) continue;
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push({ type: row[4], time: row[5], latitude: row[6], longitude: row[7], address: row[8] });
  }
  return { success: true, year: y, month: m, logs: byDate };
}

// ============================================================
// 月次サマリー取得
// ============================================================

function getMonthlySummary(params) {
  const { employee_id, year, month } = params;
  if (!employee_id) return { success: false, error: '社員IDが必要です' };

  const sheet = getSheet(SHEET_SUMMARY);
  const data  = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[0] == employee_id && row[2] == year && row[3] == month) {
      return {
        success:             true,
        employee_id:         row[0],
        name:                row[1],
        year:                row[2],
        month:               row[3],
        work_days:           row[4],
        total_work_minutes:  row[5],
        overtime_minutes:    row[6],
        late_night_minutes:  row[7],
        holiday_minutes:     row[8],
        updated_at:          row[9],
      };
    }
  }
  return { success: true, year, month, work_days: 0, total_work_minutes: 0,
    overtime_minutes: 0, late_night_minutes: 0, holiday_minutes: 0 };
}

// ============================================================
// サマリー更新（日次バッチ）
// ============================================================

function updateSummary(employee_id, name, refDate) {
  const year  = refDate.getUTCFullYear();
  const month = refDate.getUTCMonth() + 1;

  const logSheet = getSheet(SHEET_LOG);
  const logData  = logSheet.getDataRange().getValues();

  const byDate = {};
  for (let i = 1; i < logData.length; i++) {
    const row = logData[i];
    if (row[1] != employee_id) continue;
    const d = row[3];
    if (!d) continue;
    const parts = d.split('-');
    if (parseInt(parts[0]) !== year || parseInt(parts[1]) !== month) continue;
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push({ type: row[4], time: row[5] });
  }

  let workDays         = 0;
  let totalWorkMinutes = 0;
  let overtimeMinutes  = 0;
  let lateNightMinutes = 0;
  let holidayMinutes   = 0;

  for (const dateStr in byDate) {
    const records  = byDate[dateStr];
    const dateParts = dateStr.split('-');
    const dateObj   = new Date(parseInt(dateParts[0]), parseInt(dateParts[1]) - 1, parseInt(dateParts[2]));
    const isWeekend = (dateObj.getDay() === 0 || dateObj.getDay() === 6);

    const clockIn  = records.find(r => r.type === '出勤' || r.type === '直行');
    const clockOut = records.find(r => r.type === '退勤' || r.type === '直帰');

    if (!clockIn || !clockOut) continue;

    const inTime  = parseTime(clockIn.time);
    const outTime = parseTime(clockOut.time);
    if (!inTime || !outTime) continue;

    const workedMinutes = (outTime - inTime) - BREAK_MINUTES;
    if (workedMinutes <= 0) continue;

    workDays++;
    totalWorkMinutes += workedMinutes;

    const overtime = Math.max(0, workedMinutes - STANDARD_WORK_MINUTES);
    overtimeMinutes += overtime;

    if (isWeekend) {
      holidayMinutes += workedMinutes;
    }

    // 深夜残業計算（22:00以降の勤務時間）
    const lateStart = LATE_NIGHT_HOUR * 60;
    const outMinutes = outTime;
    if (outMinutes > lateStart) {
      const lateIn = Math.max(inTime, lateStart);
      lateNightMinutes += outMinutes - lateIn;
    }
  }

  const summarySheet = getSheet(SHEET_SUMMARY);
  const summaryData  = summarySheet.getDataRange().getValues();
  const jstNow       = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
  const updatedAt    = Utilities.formatDate(jstNow, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');

  let rowIndex = -1;
  for (let i = 1; i < summaryData.length; i++) {
    if (summaryData[i][0] == employee_id && summaryData[i][2] == year && summaryData[i][3] == month) {
      rowIndex = i + 1;
      break;
    }
  }

  const rowData = [employee_id, name, year, month, workDays, totalWorkMinutes,
    overtimeMinutes, lateNightMinutes, holidayMinutes, updatedAt];

  if (rowIndex > 0) {
    summarySheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
  } else {
    summarySheet.appendRow(rowData);
  }
}

// ============================================================
// ユーティリティ
// ============================================================

function parseTime(timeStr) {
  if (!timeStr) return null;
  const parts = String(timeStr).split(':');
  if (parts.length < 2) return null;
  return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}

// ============================================================
// 管理者用：社員登録
// ============================================================

function addEmployee(name, email, department, employee_id) {
  const sheet = getSheet(SHEET_MASTER);
  const id    = Utilities.getUuid();
  const jstNow = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
  const created = Utilities.formatDate(jstNow, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
  sheet.appendRow([id, employee_id || id.substring(0, 8), name, email, department || '', created, true]);
  Logger.log('社員追加: ' + name + ' (' + email + ')');
}

// ============================================================
// 月次サマリー一括再計算（管理者用）
// ============================================================

function recalculateAllSummaries() {
  const logSheet = getSheet(SHEET_LOG);
  const logData  = logSheet.getDataRange().getValues();

  const employees = {};
  for (let i = 1; i < logData.length; i++) {
    const row = logData[i];
    if (!row[1]) continue;
    employees[row[1]] = row[2];
  }

  const now = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
  for (const eid in employees) {
    updateSummary(eid, employees[eid], now);
  }
  Logger.log('全サマリー再計算完了');
}
