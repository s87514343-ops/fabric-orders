/**
 * סקריפט הגיליון של "ניהול הזמנות בדים" — גרסה מאובטחת.
 *
 * כל בקשה חייבת לשאת טוקן זהות (idToken) שהתקבל מהתחברות Google באפליקציה.
 * הטוקן מאומת מול גוגל, ורק לאחר מכן נבדק אם המייל נמצא ברשימת המורשים.
 * הבדיקה מתבצעת כאן, בשרת, ולכן לא ניתן לעקוף אותה מצד הלקוח.
 *
 * ⚠️ הקובץ הזה הוא תבנית. בגיליון האמיתי יש למלא את שני הערכים למטה.
 *    אין להעלות לכאן כתובות מייל אמיתיות — המאגר ציבורי.
 *
 * ⚠️ אחרי כל הדבקה של הקוד יש להריץ ידנית את testAuth פעם אחת ולאשר
 *    את ההרשאות. בלי זה UrlFetchApp נחסם, האימות נכשל, וכל התחברות
 *    נדחית עם "אין הרשאת גישה לאינטרנט". פריסה בלבד אינה מספיקה.
 *
 * הגדרות הפריסה (Deploy ← Manage deployments ← ✏️ ← New version):
 *    Execute as:        Me
 *    Who has access:    Anyone
 * "Anyone" נחוץ כדי שהדפדפן יוכל לפנות לכאן; האבטחה היא בטוקן, לא בהגדרה הזו.
 *
 * מבנה הגיליון:
 *    הגיליון הראשון  — ההזמנות (loadRows / saveRows)
 *    "הצעות מחיר"    — ארכיון הצעות המחיר (loadQuotes / saveQuotes),
 *                      נוצר אוטומטית בשמירה הראשונה.
 */

/* המשתמשים המורשים. להוסיף או להסיר — לערוך ולפרוס גרסה חדשה. */
var ALLOWED_EMAILS = [
  'REPLACE_WITH_ALLOWED_EMAIL@gmail.com'
];

/* מזהה ה-OAuth של האפליקציה, מ-Google Cloud Console */
var CLIENT_ID = 'REPLACE_WITH_CLIENT_ID.apps.googleusercontent.com';

/* שם הגיליון שבו נשמר ארכיון הצעות המחיר */
var QUOTES_SHEET = 'הצעות מחיר';


/* יש להריץ ידנית פעם אחת אחרי כל החלפת קוד — מאשר את ההרשאות */
function testAuth() {
  var res = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=dummy',
    { muteHttpExceptions: true });
  Logger.log('גישה לאינטרנט: תקינה (HTTP ' + res.getResponseCode() + ')');
  Logger.log('CLIENT_ID: ' + CLIENT_ID);
  Logger.log('מורשים: ' + ALLOWED_EMAILS.join(', '));
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * מאמת את הטוקן מול גוגל.
 * מחזיר { ok: true, email } או { ok: false, reason } עם סיבה קריאה למשתמש.
 * בדיקת ה-aud קריטית: בלעדיה טוקן שהונפק לאפליקציה אחרת היה מתקבל כתקין.
 */
function verifyToken(idToken) {
  if (!idToken) return { ok: false, reason: 'לא התקבל טוקן' };

  var cache = CacheService.getScriptCache();
  var key = 'tok_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken));
  var hit = cache.get(key);
  if (hit) return { ok: true, email: hit };

  var res;
  try {
    res = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
      { muteHttpExceptions: true });
  } catch (err) {
    return { ok: false, reason: 'אין הרשאת גישה לאינטרנט — יש להריץ testAuth' };
  }

  if (res.getResponseCode() !== 200) {
    return { ok: false, reason: 'גוגל דחתה את הטוקן (HTTP ' + res.getResponseCode() + ')' };
  }

  var info;
  try {
    info = JSON.parse(res.getContentText());
  } catch (err) {
    return { ok: false, reason: 'תשובה לא קריאה מגוגל' };
  }

  if (info.aud !== CLIENT_ID) {
    return { ok: false, reason: 'המזהה אינו תואם. התקבל: ' + String(info.aud).slice(0, 24) + '…' };
  }
  if (String(info.email_verified) !== 'true') {
    return { ok: false, reason: 'המייל אינו מאומת אצל גוגל' };
  }
  if (Number(info.exp) * 1000 < Date.now()) {
    return { ok: false, reason: 'הטוקן פג תוקף' };
  }

  var email = String(info.email || '').toLowerCase().trim();
  if (!email) return { ok: false, reason: 'לא התקבלה כתובת מייל' };

  cache.put(key, email, 300);   /* חמש דקות, כדי לא לאמת מחדש בכל שמירה */
  return { ok: true, email: email };
}

function isAllowed(email) {
  for (var i = 0; i < ALLOWED_EMAILS.length; i++) {
    if (String(ALLOWED_EMAILS[i]).toLowerCase().trim() === email) return true;
  }
  return false;
}

function doPost(e) {
  var payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut({ ok: false, error: 'bad_request' });
  }

  var v = verifyToken(payload.idToken);
  if (!v.ok) return jsonOut({ ok: false, error: 'unauthenticated', reason: v.reason });
  if (!isAllowed(v.email)) return jsonOut({ ok: false, error: 'forbidden', email: v.email });

  if (payload.action === 'load')       return loadRows();
  if (payload.action === 'save')       return saveRows(payload);
  if (payload.action === 'loadQuotes') return loadSheetAsObjects(QUOTES_SHEET);
  if (payload.action === 'saveQuotes') return writeSheet(QUOTES_SHEET, payload);
  return jsonOut({ ok: false, error: 'unknown_action' });
}

/* ---------- הזמנות: הגיליון הראשון ---------- */

function loadRows() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  var data = sheet.getDataRange().getValues();
  if (!data.length) return jsonOut({ ok: true, headers: [], rows: [] });

  var headers = data[0];
  var rows = data.slice(1).map(function (r) {
    var obj = {};
    headers.forEach(function (h, i) { obj[h] = r[i]; });
    return obj;
  });
  return jsonOut({ ok: true, headers: headers, rows: rows });
}

function saveRows(payload) {
  var headers = payload.headers || [];
  var rows = payload.rows || [];
  if (!headers.length) return jsonOut({ ok: false, error: 'no_headers' });

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return jsonOut({ ok: false, error: 'busy' });

  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    sheet.clearContents();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    if (rows.length > 0) {
      sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    }
    SpreadsheetApp.flush();
    return jsonOut({ ok: true, saved: rows.length });
  } finally {
    lock.releaseLock();
  }
}

/* ---------- ארכיון הצעות המחיר: גיליון נפרד ---------- */

/* מחזיר את הגיליון לפי שם, ויוצר אותו אם אינו קיים */
function sheetByName(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}

function loadSheetAsObjects(name) {
  var sheet = sheetByName(name);
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return jsonOut({ ok: true, headers: [], rows: [] });

  var headers = data[0];
  var rows = data.slice(1).map(function (r) {
    var obj = {};
    headers.forEach(function (h, i) { obj[h] = r[i]; });
    return obj;
  });
  return jsonOut({ ok: true, headers: headers, rows: rows });
}

function writeSheet(name, payload) {
  var headers = payload.headers || [];
  var rows = payload.rows || [];
  if (!headers.length) return jsonOut({ ok: false, error: 'no_headers' });

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return jsonOut({ ok: false, error: 'busy' });

  try {
    var sheet = sheetByName(name);
    sheet.clearContents();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    if (rows.length > 0) {
      sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    }
    SpreadsheetApp.flush();
    return jsonOut({ ok: true, saved: rows.length });
  } finally {
    lock.releaseLock();
  }
}

/* גישה ישירה מהדפדפן אינה מחזירה נתונים */
function doGet(e) {
  return jsonOut({ ok: false, error: 'use_post' });
}
