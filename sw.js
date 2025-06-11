/**
 * Service Worker for LLM Probability Analyzer
 * Provides offline capability and performance optimization
 */

const CACHE_NAME = 'llm-analyzer-v2.1.0';
const STATIC_CACHE = 'llm-analyzer-static-v2.1.0';
const DYNAMIC_CACHE = 'llm-analyzer-dynamic-v2.1.0';

// Files to cache for offline functionality
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/style.css',
    '/manifest.json'
];

// WebLLM and external resources that should be cached
const EXTERNAL_RESOURCES = [
    'https://esm.run/@mlc-ai/web-llm',
    'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'
];

// Cache strategies
const CACHE_STRATEGIES = {
    NETWORK_FIRST: 'network-first',
    CACHE_FIRST: 'cache-first',
    STALE_WHILE_REVALIDATE: 'stale-while-revalidate'
};

/**
 * Service Worker Installation
 */
self.addEventListener('install', event => {
    console.log('[SW] Installing service worker...');
    
    event.waitUntil(
        Promise.all([
            // Cache static assets
            caches.open(STATIC_CACHE).then(cache => {
                console.log('[SW] Caching static assets');
                return cache.addAll(STATIC_ASSETS);
            }),
            
            // Pre-cache critical external resources
            caches.open(DYNAMIC_CACHE).then(cache => {
                console.log('[SW] Pre-caching external resources');
                return Promise.allSettled(
                    EXTERNAL_RESOURCES.map(url => 
                        fetch(url).then(response => {
                            if (response.ok) {
                                return cache.put(url, response);
                            }
                        }).catch(error => {
                            console.warn(`[SW] Failed to cache ${url}:`, error);
                        })
                    )
                );
            })
        ]).then(() => {
            console.log('[SW] Service worker installed successfully');
            // Force activation of new service worker
            return self.skipWaiting();
        })
    );
});

/**
 * Service Worker Activation
 */
self.addEventListener('activate', event => {
    console.log('[SW] Activating service worker...');
    
    event.waitUntil(
        Promise.all([
            // Clean up old caches
            caches.keys().then(cacheNames => {
                return Promise.all(
                    cacheNames.map(cacheName => {
                        if (cacheName !== STATIC_CACHE && 
                            cacheName !== DYNAMIC_CACHE && 
                            cacheName !== CACHE_NAME) {
                            console.log('[SW] Deleting old cache:', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            }),
            
            // Claim all clients immediately
            self.clients.claim()
        ]).then(() => {
            console.log('[SW] Service worker activated successfully');
        })
    );
});

/**
 * Fetch Event Handler - Main caching logic
 */
self.addEventListener('fetch', event => {
    const { request } = event;
    const url = new URL(request.url);
    
    // Skip non-GET requests
    if (request.method !== 'GET') {
        return;
    }
    
    // Handle different types of requests
    if (isStaticAsset(url)) {
        event.respondWith(handleStaticAsset(request));
    } else if (isWebLLMResource(url)) {
        event.respondWith(handleWebLLMResource(request));
    } else if (isExternalResource(url)) {
        event.respondWith(handleExternalResource(request));
    } else if (isAPIRequest(url)) {
        event.respondWith(handleAPIRequest(request));
    } else {
        event.respondWith(handleDefault(request));
    }
});

/**
 * Handle static assets (HTML, CSS, JS)
 * Strategy: Cache first with network fallback
 */
async function handleStaticAsset(request) {
    try {
        const cachedResponse = await caches.match(request);
        
        if (cachedResponse) {
            console.log('[SW] Serving from cache:', request.url);
            
            // Update cache in background
            fetch(request).then(response => {
                if (response.ok) {
                    caches.open(STATIC_CACHE).then(cache => {
                        cache.put(request, response.clone());
                    });
                }
            }).catch(() => {
                // Ignore network errors in background update
            });
            
            return cachedResponse;
        }
        
        // Fetch from network and cache
        const networkResponse = await fetch(request);
        
        if (networkResponse.ok) {
            const cache = await caches.open(STATIC_CACHE);
            cache.put(request, networkResponse.clone());
            console.log('[SW] Cached new static asset:', request.url);
        }
        
        return networkResponse;
        
    } catch (error) {
        console.error('[SW] Error handling static asset:', error);
        
        // Return offline fallback if available
        if (request.destination === 'document') {
            return caches.match('/index.html') || createOfflinePage();
        }
        
        throw error;
    }
}

/**
 * Handle WebLLM library resources
 * Strategy: Cache first with network fallback for critical resources
 */
async function handleWebLLMResource(request) {
    try {
        const cachedResponse = await caches.match(request);
        
        if (cachedResponse) {
            console.log('[SW] Serving WebLLM resource from cache:', request.url);
            return cachedResponse;
        }
        
        // Fetch from network
        const networkResponse = await fetch(request, {
            headers: {
                'Accept': 'application/javascript, text/javascript, */*'
            }
        });
        
        if (networkResponse.ok) {
            const cache = await caches.open(DYNAMIC_CACHE);
            cache.put(request, networkResponse.clone());
            console.log('[SW] Cached WebLLM resource:', request.url);
        }
        
        return networkResponse;
        
    } catch (error) {
        console.error('[SW] Error handling WebLLM resource:', error);
        
        // Check cache one more time
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            return cachedResponse;
        }
        
        throw error;
    }
}

/**
 * Handle external resources (CDNs, APIs)
 * Strategy: Network first with cache fallback
 */
async function handleExternalResource(request) {
    try {
        // Try network first
        const networkResponse = await fetch(request, {
            // Add timeout for external resources
            signal: AbortSignal.timeout(10000)
        });
        
        if (networkResponse.ok) {
            // Cache successful responses
            const cache = await caches.open(DYNAMIC_CACHE);
            cache.put(request, networkResponse.clone());
            console.log('[SW] Cached external resource:', request.url);
        }
        
        return networkResponse;
        
    } catch (error) {
        console.warn('[SW] Network failed for external resource:', request.url, error);
        
        // Fallback to cache
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            console.log('[SW] Serving external resource from cache:', request.url);
            return cachedResponse;
        }
        
        throw error;
    }
}

/**
 * Handle API requests
 * Strategy: Network only (no caching for dynamic data)
 */
async function handleAPIRequest(request) {
    try {
        return await fetch(request);
    } catch (error) {
        console.error('[SW] API request failed:', error);
        
        // Return offline response for API requests
        return new Response(
            JSON.stringify({
                error: 'Offline',
                message: 'This feature requires an internet connection'
            }),
            {
                status: 503,
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );
    }
}

/**
 * Default handler for other requests
 * Strategy: Network first with cache fallback
 */
async function handleDefault(request) {
    try {
        const networkResponse = await fetch(request);
        
        // Cache successful responses
        if (networkResponse.ok && shouldCache(request)) {
            const cache = await caches.open(DYNAMIC_CACHE);
            cache.put(request, networkResponse.clone());
        }
        
        return networkResponse;
        
    } catch (error) {
        // Check cache
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            return cachedResponse;
        }
        
        throw error;
    }
}

/**
 * Utility Functions
 */

function isStaticAsset(url) {
    const pathname = url.pathname;
    return pathname === '/' || 
           pathname.endsWith('.html') || 
           pathname.endsWith('.css') || 
           pathname.endsWith('.js') ||
           pathname.endsWith('.json') ||
           pathname.endsWith('.ico');
}

function isWebLLMResource(url) {
    return url.hostname === 'esm.run' && 
           url.pathname.includes('@mlc-ai/web-llm');
}

function isExternalResource(url) {
    return url.hostname !== self.location.hostname &&
           (url.hostname === 'cdnjs.cloudflare.com' ||
            url.hostname === 'esm.run' ||
            url.hostname === 'cdn.jsdelivr.net');
}

function isAPIRequest(url) {
    return url.pathname.startsWith('/api/') ||
           url.hostname.includes('api.') ||
           url.search.includes('api_key');
}

function shouldCache(request) {
    const url = new URL(request.url);
    
    // Don't cache very large files
    if (url.pathname.includes('.wasm') && !url.pathname.includes('web-llm')) {
        return false;
    }
    
    // Don't cache model files (they're too large)
    if (url.pathname.includes('.bin') || url.pathname.includes('.safetensors')) {
        return false;
    }
    
    return true;
}

function createOfflinePage() {
    const offlineHTML = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>LLM Analyzer - Offline</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
                    background: #0a0b0f;
                    color: #f0f2f5;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                    margin: 0;
                    text-align: center;
                    padding: 20px;
                }
                .offline-icon {
                    font-size: 64px;
                    margin-bottom: 20px;
                }
                h1 {
                    color: #7bb3ff;
                    margin-bottom: 16px;
                }
                p {
                    color: #a8adb8;
                    max-width: 400px;
                    line-height: 1.5;
                    margin-bottom: 24px;
                }
                .retry-btn {
                    padding: 12px 24px;
                    background: #7bb3ff;
                    color: #0a0b0f;
                    border: none;
                    border-radius: 8px;
                    cursor: pointer;
                    font-size: 14px;
                    font-weight: 600;
                }
            </style>
        </head>
        <body>
            <div class="offline-icon">📱</div>
            <h1>You're Offline</h1>
            <p>
                The LLM Probability Analyzer requires an internet connection to load models and process data. 
                Please check your connection and try again.
            </p>
            <button class="retry-btn" onclick="window.location.reload()">
                Try Again
            </button>
        </body>
        </html>
    `;
    
    return new Response(offlineHTML, {
        headers: {
            'Content-Type': 'text/html'
        }
    });
}

/**
 * Background Sync for offline actions
 */
self.addEventListener('sync', event => {
    console.log('[SW] Background sync triggered:', event.tag);
    
    if (event.tag === 'background-sync') {
        event.waitUntil(doBackgroundSync());
    }
});

async function doBackgroundSync() {
    try {
        // Implement background sync logic if needed
        console.log('[SW] Performing background sync...');
        
        // For example: sync cached analysis results when back online
        const cache = await caches.open(DYNAMIC_CACHE);
        const requests = await cache.keys();
        
        // Process any pending sync tasks
        for (const request of requests) {
            if (request.url.includes('pending-sync')) {
                // Handle pending synchronization
                console.log('[SW] Processing pending sync:', request.url);
            }
        }
        
    } catch (error) {
        console.error('[SW] Background sync failed:', error);
    }
}

/**
 * Push notifications (if needed in the future)
 */
self.addEventListener('push', event => {
    console.log('[SW] Push notification received');
    
    const options = {
        body: 'LLM Analyzer has been updated',
        icon: '/icon-192.png',
        badge: '/icon-72.png',
        tag: 'llm-analyzer-update',
        requireInteraction: false,
        actions: [
            {
                action: 'open',
                title: 'Open App'
            },
            {
                action: 'dismiss',
                title: 'Dismiss'
            }
        ]
    };
    
    event.waitUntil(
        self.registration.showNotification('LLM Probability Analyzer', options)
    );
});

/**
 * Notification click handler
 */
self.addEventListener('notificationclick', event => {
    console.log('[SW] Notification clicked:', event.action);
    
    event.notification.close();
    
    if (event.action === 'open' || !event.action) {
        event.waitUntil(
            clients.openWindow('/')
        );
    }
});

/**
 * Cache management - cleanup old entries
 */
self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
    
    if (event.data && event.data.type === 'CLEAR_CACHE') {
        event.waitUntil(clearOldCaches());
    }
});

async function clearOldCaches() {
    try {
        const cacheNames = await caches.keys();
        const oldCaches = cacheNames.filter(name => 
            !name.includes('v2.1.0') && 
            name.includes('llm-analyzer')
        );
        
        await Promise.all(
            oldCaches.map(cacheName => {
                console.log('[SW] Clearing old cache:', cacheName);
                return caches.delete(cacheName);
            })
        );
        
        console.log('[SW] Cache cleanup completed');
    } catch (error) {
        console.error('[SW] Cache cleanup failed:', error);
    }
}

/**
 * Periodic cache cleanup (runs every 24 hours)
 */
setInterval(() => {
    clearOldCaches();
}, 24 * 60 * 60 * 1000);

console.log('[SW] Service Worker script loaded successfully');
