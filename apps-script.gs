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
 * הגדרות הפריסה הנדרשות (פריסה ← פריסה חדשה ← אפליקציית אינטרנט):
 *    Execute as:        Me
 *    Who has access:    Anyone
 * "Anyone" נחוץ כדי שהדפדפן יוכל לפנות לכאן; האבטחה היא בטוקן, לא בהגדרה הזו.
 */

/* המשתמשים המורשים. להוסיף או להסיר — פשוט לערוך את הרשימה ולפרוס מחדש. */
var ALLOWED_EMAILS = [
  'REPLACE_WITH_ALLOWED_EMAIL@gmail.com'
];

/* מזהה ה-OAuth של האפליקציה, מ-Google Cloud Console */
var CLIENT_ID = 'REPLACE_WITH_CLIENT_ID.apps.googleusercontent.com';


function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * מאמת את הטוקן מול גוגל ומחזיר את כתובת המייל, או null אם אינו תקין.
 * בדיקת ה-aud קריטית: בלעדיה אפשר היה להשתמש בטוקן שהונפק לאפליקציה אחרת.
 */
function verifyToken(idToken) {
  if (!idToken) return null;

  var cache = CacheService.getScriptCache();
  var key = 'tok_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken));
  var hit = cache.get(key);
  if (hit) return hit;

  try {
    var res = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
      { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;

    var info = JSON.parse(res.getContentText());
    if (info.aud !== CLIENT_ID) return null;
    if (String(info.email_verified) !== 'true') return null;
    if (Number(info.exp) * 1000 < Date.now()) return null;

    var email = String(info.email || '').toLowerCase().trim();
    if (!email) return null;

    cache.put(key, email, 300);   /* חמש דקות, כדי לא לאמת מחדש בכל שמירה */
    return email;
  } catch (err) {
    return null;
  }
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

  var email = verifyToken(payload.idToken);
  if (!email) return jsonOut({ ok: false, error: 'unauthenticated' });
  if (!isAllowed(email)) return jsonOut({ ok: false, error: 'forbidden', email: email });

  if (payload.action === 'load') return loadRows();
  if (payload.action === 'save') return saveRows(payload);
  return jsonOut({ ok: false, error: 'unknown_action' });
}

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

  /* נעילה — מונעת שיבוש אם שני מכשירים שומרים באותו רגע */
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

/* גישה ישירה מהדפדפן אינה מחזירה נתונים */
function doGet(e) {
  return jsonOut({ ok: false, error: 'use_post' });
}
