const CACHE='voiceplan-v1';
const ASSETS=['./','./index.html','./styles.css','./app.js','./manifest.webmanifest','./icon.svg'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',e=>e.respondWith(caches.match(e.request).then(cached=>cached||fetch(e.request).then(response=>{if(e.request.method==='GET'){const clone=response.clone();caches.open(CACHE).then(c=>c.put(e.request,clone));}return response;}).catch(()=>caches.match('./index.html')))));
