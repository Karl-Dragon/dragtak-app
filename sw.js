// DragTak — service worker : appli disponible hors ligne + cartes IGN en cache
// Tuiles : cache d'abord, sinon réseau (et mise en cache de tout ce qui est regardé),
// sinon agrandissement d'une tuile parente déjà en cache (jamais d'écran blanc).
const VERSION = 'v1-2026-10-24zi'
const APP = 'dt-app-' + VERSION
const TUILES = 'dt-tuiles'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('dt-app-') && k !== APP) await caches.delete(k)
  await self.clients.claim()
})()))

// Clé de cache d'une tuile : sans le paramètre de nouvel essai « &r= »
const cle = url => url.replace(/&r=\d+$/, '')
const xyz = url => { const u = new URL(url); return { z: +u.searchParams.get('TILEMATRIX'), y: +u.searchParams.get('TILEROW'), x: +u.searchParams.get('TILECOL') } }
const avec = (url, z, x, y) => { const u = new URL(cle(url)); u.searchParams.set('TILEMATRIX', z); u.searchParams.set('TILEROW', y); u.searchParams.set('TILECOL', x); return u.toString() }

async function tuile(req) {
  const c = await caches.open(TUILES)
  const k = cle(req.url)
  const deja = await c.match(k)
  if (deja) return deja
  try {
    let r
    try { r = await fetch(k, { mode: 'cors', credentials: 'omit' }) }
    catch (e) {
      // Point d'accès privé (SCAN 25) sans en-tête CORS : on affiche la tuile sans la mettre en cache
      if (!navigator.onLine) throw e
      const o = await fetch(k, { mode: 'no-cors', credentials: 'omit' })
      if (o.type === 'opaque') return o
      throw e
    }
    if (r.ok) { c.put(k, r.clone()); return r }
    throw new Error('http ' + r.status)
  } catch (err) {
    // Hors ligne : on cherche une tuile parente (jusqu'à 5 niveaux au-dessus) et on l'agrandit
    try {
      const { z, x, y } = xyz(k)
      for (let d = 1; d <= 5 && z - d >= 0; d++) {
        const px = x >> d, py = y >> d
        const p = await c.match(avec(k, z - d, px, py))
        if (!p) continue
        const n = 1 << d, taille = 256 / n
        const img = await createImageBitmap(await p.blob())
        const cv = new OffscreenCanvas(256, 256); const g = cv.getContext('2d')
        g.imageSmoothingEnabled = true
        g.drawImage(img, (x - px * n) * taille, (y - py * n) * taille, taille, taille, 0, 0, 256, 256)
        return new Response(await cv.convertToBlob({ type: 'image/png' }), { headers: { 'Content-Type': 'image/png' } })
      }
    } catch (e) { }
    return new Response('', { status: 504 })
  }
}

self.addEventListener('fetch', e => {
  const req = e.request
  if (req.method !== 'GET') return
  const u = new URL(req.url)
  if (u.hostname === 'data.geopf.fr' && u.searchParams.get('REQUEST') === 'GetTile') { e.respondWith(tuile(req)); return }
  if (u.origin !== self.location.origin) return // Supabase, etc. : jamais intercepté
  // Fichiers versionnés de l'appli (/assets/nom-HASH.js|css|woff2) : jamais modifiés → cache d'abord (ouverture rapide, pas de 4G consommée)
  if (u.pathname.includes('/assets/')) {
    e.respondWith((async () => {
      const c = await caches.open(APP)
      const deja = await c.match(req) || await caches.match(req) // aussi dans le cache d'une version précédente
      if (deja) return deja
      const r = await fetch(req)
      if (r.ok) c.put(req, r.clone())
      return r
    })())
    return
  }
  // Page et autres fichiers : réseau d'abord (pour recevoir les mises à jour), cache si pas de réseau
  // ou si le réseau ne répond pas en 4 s (4G faible : l'appli s'ouvre quand même, la mise à jour arrive en fond)
  e.respondWith((async () => {
    const c = await caches.open(APP)
    const cleC = req.mode === 'navigate' ? './' : req
    const reseau = fetch(req, req.mode === 'navigate' ? { cache: 'no-cache' } : undefined).then(r => { if (r.ok) c.put(cleC, r.clone()); return r })
    const enCache = await c.match(cleC) || (req.mode === 'navigate' ? await caches.match('./') : undefined)
    if (!enCache) return reseau.catch(() => new Response('Hors ligne', { status: 503 }))
    reseau.catch(() => { })
    const delai = new Promise(r => setTimeout(() => r(null), 4000))
    try { return (await Promise.race([reseau, delai])) || enCache } catch { return enCache }
  })())
})

// Notification « Nouveau message » touchée (téléphone ou montre) : on ramène DragTak au premier plan
self.addEventListener('notificationclick', e => {
  e.notification.close()
  e.waitUntil((async () => {
    const l = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    if (l.length) return l[0].focus()
    return self.clients.openWindow(self.registration.scope)
  })())
})
