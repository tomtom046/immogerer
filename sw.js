// Service worker ImmoGérer : rend l'application installable et permet de l'ouvrir hors connexion.
// - Fichiers de l'app : réseau d'abord (les mises à jour arrivent tout de suite), cache si hors ligne.
// - Bibliothèques externes (CDN) : cache, rafraîchi en arrière-plan.
// - Firebase / Google (données, connexion, Gmail) : jamais mis en cache.
const CACHE = 'immogerer-v3';
const APP_SHELL = ['./', './index.html', './css/style.css', './js/app.js', './manifest.webmanifest', './icons/icon-192.png'];
const CDN_HOSTS = ['cdn.tailwindcss.com', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'www.gstatic.com'];

self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE).then(c => c.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);

    if (url.origin === self.location.origin) {
        event.respondWith(
            fetch(req).then(res => {
                if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
                return res;
            }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./index.html')))
        );
        return;
    }

    // Le SDK Firebase sur gstatic est versionné : on le met en cache. Le reste de Google passe directement.
    if (CDN_HOSTS.includes(url.hostname) && (url.hostname !== 'www.gstatic.com' || url.pathname.startsWith('/firebasejs/'))) {
        event.respondWith(
            caches.open(CACHE).then(cache => cache.match(req).then(cached => {
                const network = fetch(req).then(res => {
                    if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
                    return res;
                }).catch(() => cached);
                return cached || network;
            }))
        );
    }
});
