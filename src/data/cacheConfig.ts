// Cuánto se guardan los datos para consultarlos sin conexión. No puede pasar de 24 días: el
// navegador dispara al instante cualquier temporizador más largo, y la caché se vaciaría sola.
export const keepCacheMs = 20 * 24 * 60 * 60 * 1000

export const cachePrefix = 'nevera.cache.'

// Súbelo si cambia la forma de los datos guardados: descarta las copias anteriores.
export const cacheVersion = '1'
