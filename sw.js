/* Service Worker לאפליקציית "ניהול הזמנות בדים"
   מאפשר התקנה כאפליקציה ועבודה גם בלי אינטרנט.
   שים לב: הקובץ הזה חייב להיות באותה תיקייה כמו קובץ ה-HTML כשמעלים לאחסון. */

/* העלאת המספר מכריחה את כל המכשירים לרענן את המטמון.
   יש להעלות אותו בכל שינוי בקבצים הסטטיים. */
const CACHE = 'fabric-orders-v24';

/* קבצי הליבה — נשמרים מראש כדי שהאפליקציה תיפתח גם בלי אינטרנט */
const CORE = [
  './', './index.html', './manifest.json',
  './icon-192.png', './icon-512.png',
  './q-head.jpg', './q-foot.jpg',
];

/* התקנה — שומרים את הליבה ונכנסים לתוקף מיד.
   cache:'reload' מונע שמירה מחדש של גרסה ישנה מהמטמון של הדפדפן. */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(
        CORE.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {}))
      ))
      .then(() => self.skipWaiting())
  );
});

/* הפעלה — מנקים גרסאות ישנות של המטמון */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  /* רק בקשות GET נשמרות במטמון */
  if (req.method !== 'GET') return;

  /* בקשות ל-Google Sheets תמיד הולכות לרשת — הנתונים חייבים להיות עדכניים */
  if (req.url.includes('script.google.com') || req.url.includes('script.googleusercontent.com')) return;

  /* ניווט (פתיחת האפליקציה): רשת קודם, ואם אין אינטרנט — מהמטמון */
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then(hit => hit || caches.match('./')))
    );
    return;
  }

  /* שאר המשאבים (גופנים, ספריות): מהמטמון קודם, ומרעננים ברקע */
  event.respondWith(
    caches.match(req).then(hit => {
      const network = fetch(req)
        .then(res => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || network;
    })
  );
});
