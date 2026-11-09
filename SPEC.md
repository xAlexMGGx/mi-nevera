# SPEC — Nevera digital

> Documento de especificación para implementar la app por fases con Claude Code.
> Es la fuente de verdad: si algo del código contradice este documento, manda este documento.
> Si algo no está definido aquí, **pregunta antes de decidir**.

---

## 1. Visión

App para saber en todo momento qué comida hay en cada casa (frigorífico, congelador y despensa), en qué cantidad y cuándo caduca, para no tirar comida y no comprar de más. La usará una familia (unas pocas personas) que comparte una o varias casas y la edita en tiempo real.

**Usuarios:** familia y personas cercanas. Una cuenta por persona. No se publica en App Store ni Google Play.

**Dispositivos:** iPhone primero, Android después. Ambos con la misma app (PWA instalable).

---

## 2. Principios de diseño (obligatorios)

1. **El producto importa, la marca no.** La marca nunca aparece en la vista principal del inventario; solo en el detalle del producto y en la lista de la compra.
2. **Nada se rellena solo.** Las fechas sugeridas (por historial o por la guía de conservación) se muestran como *chips* que el usuario acepta con un toque. Si no los toca, el campo queda vacío.
3. **Siempre preview antes de cambios masivos.** Escanear ticket y "He cocinado esto" muestran una vista previa editable antes de aplicar nada.
4. **Operaciones atómicas en servidor.** Restar, mover, abrir, etc. se hacen con funciones de Postgres (RPC) que operan sobre el valor actual ("resta 1"), nunca enviando el valor final desde el cliente. Así dos personas pueden editar a la vez sin pisarse.
5. **Sin usuarios en el historial.** El historial de movimientos no guarda quién hizo cada acción (decisión deliberada para evitar mal ambiente). No añadir `user_id` a esa tabla.
6. **Bilingüe desde el primer día.** Español e inglés; ningún texto de interfaz escrito a mano en los componentes, todo con claves de traducción.
7. **No inventar datos de seguridad alimentaria.** Los tiempos de conservación y la información de seguridad salen de fuentes oficiales citadas (ver §9) y el propietario los revisa antes de darlos por buenos.
8. **Mobile-first.** Diseñada para usarse con una mano en el móvil. Respetar las zonas seguras del iPhone (notch, barra inferior). Soporte de modo oscuro.

---

## 3. Stack y arquitectura

| Pieza | Elección |
|---|---|
| Frontend | React + Vite + TypeScript |
| Estilos | Tailwind CSS |
| PWA | `vite-plugin-pwa` (manifest, service worker, instalable en iOS y Android) |
| Datos en cliente | TanStack Query; caché persistida en IndexedDB para consulta sin conexión |
| i18n | `i18next` + `react-i18next` |
| Backend | Supabase: Auth, Postgres con Row Level Security, Realtime, Storage, Edge Functions, `pg_cron` |
| Búsqueda | `Fuse.js` (difusa, en cliente). Fase 8: embeddings con `pgvector` |
| Código de barras | `@zxing/browser` (Safari en iPhone no ofrece un lector nativo fiable) |
| Datos de producto | API de Open Food Facts (por código de barras). Verificar la documentación actual antes de implementar |
| IA | Modelo multimodal de Anthropic (Claude) vía API, **solo** desde Edge Functions. Nombre del modelo en variable de entorno, no en el código |
| Push | Web Push con claves VAPID (en iOS solo funciona con la app instalada en pantalla de inicio) |
| Hosting | GitHub Pages. Usar `HashRouter` (o equivalente) para evitar 404 al recargar rutas |

**Secretos:**
- En el cliente solo va la URL de Supabase y la *publishable key* (`sb_publishable_…`; es pública, la seguridad la da RLS). Sustituye a la antigua *anon key*, que Supabase retira a finales de 2026.
- La *secret key* (`sb_secret_…`, sustituye a la *service role key*), la API key de Anthropic y la clave privada VAPID van **solo** en los secretos de Supabase Edge Functions. Nunca en el repo.
- Incluir `.env.example` sin valores reales.

**Sin conexión:** la app debe poder **consultar** el inventario de la última sincronización sin conexión (con un aviso visible "Sin conexión — solo lectura"). Editar sin conexión queda fuera de alcance.

---

## 4. Glosario

- **Casa:** unidad compartida (p. ej. "Casa", "Casa de la playa"). Tiene miembros, zonas, inventario, avisos, lista de la compra y recetas.
- **Zona:** Frigo, Congelador o Despensa. Cada casa tiene exactamente estas tres, creadas automáticamente.
- **Producto:** el concepto genérico ("Leche"). Pertenece a una casa.
- **Lote:** existencias de un producto con una misma fecha, marca y zona ("6 bricks de leche que caducan el 1/11, en el Frigo").
- **Unidad abierta:** unidad de un lote que se ha empezado ("brick abierto, queda 60 %").
- **Táper / resto:** producto de tipo *plato cocinado* (nombre libre, fecha de cocinado, raciones).
- **Fecha impresa:** la que trae el envase. Tiene tipo: *caducidad* o *consumo preferente*.
- **Fecha de aviso:** fecha opcional que el usuario fija (normalmente con un chip) al abrir, congelar, descongelar o cocinar.
- **FEFO:** *first expired, first out*. Al consumir, se resta primero de lo que caduca antes.

---

## 5. Modelo de datos

Nombres orientativos; Claude Code puede ajustarlos manteniendo el significado. Todas las tablas con `id uuid`, `created_at`, `updated_at` salvo que se indique.

### 5.1 Usuarios y casas

- **`profiles`**: `id` (= `auth.users.id`), `display_name`, `locale` (`es`|`en`), `timezone` (por defecto `Europe/Madrid`), `notify_enabled` (bool, def. true), `notify_hour` (def. 9), `notify_days_ahead` (def. 2), `recipe_preferences` (texto libre), `active_house_id`.
- **`houses`**: `name`, `created_by`.
- **`house_members`**: `house_id`, `user_id`, `role` (`owner`|`editor`), `joined_at`. PK compuesta.
- **`house_invites`**: `house_id`, `code` (corto, legible), `created_by`, `expires_at` (def. 7 días), `used_at`.
- **`zones`**: `house_id`, `kind` (`fridge`|`freezer`|`pantry`), `sort_order`. Se crean las tres al crear la casa (trigger).

### 5.2 Catálogo base (global, solo lectura)

- **`catalog_items`**: `slug`, `name_es`, `name_en`, `icon` (emoji), `category`, `default_zone` (`fridge`|`freezer`|`pantry`), `default_quantity_kind`, `default_unit_label`, `default_content_amount`, `default_content_unit`, `synonyms_es[]`, `synonyms_en[]`.
- Semilla con **150–200 alimentos comunes** en España, generada como JSON en el repo (`supabase/seed/catalog.json`) y cargada con un script.
- **Categorías:** Lácteos y huevos · Carne · Pescado y marisco · Fruta · Verdura y hortalizas · Pan y bollería · Pasta, arroz y legumbres · Conservas · Congelados · Bebidas · Salsas, aceites y condimentos · Snacks y dulces · Desayuno · Platos cocinados · Otros.

### 5.3 Inventario

- **`products`**:
  - `house_id`, `catalog_item_id` (nullable), `name`, `category`, `icon` (nullable; si no, el del catálogo o uno genérico por categoría).
  - `kind`: `food` | `cooked_dish` (táper).
  - `quantity_kind`:
    - `count` — contable simple (huevos, latas, yogures).
    - `divisible` — contable con contenido divisible (bricks de 1 L, paquetes de 500 g, botes).
    - `bulk` — a granel / por peso (tomates 1,2 kg, queso 250 g).
  - `unit_label` (p. ej. "brick", "lata", "paquete"; para tápers "ración").
  - `content_amount` + `content_unit` (`g`|`kg`|`ml`|`l`|`ud`) — solo `divisible`.
  - `bulk_unit` (`g`|`kg`|`ml`|`l`) — solo `bulk`.
  - `preferred_brand` (nullable), `brand_notes` (texto libre, p. ej. "la de Auchan no me gustó").
  - `image_url` (nullable).
  - `embedding vector` (fase 8).
- **`lots`**:
  - `house_id`, `zone_id`, `product_id`.
  - `quantity numeric` — significado según `quantity_kind`: `count` → unidades; `divisible` → unidades **cerradas**; `bulk` → cantidad en `bulk_unit`; `cooked_dish` → raciones.
  - `brand`, `barcode`, `image_url` (todos nullable).
  - `printed_date` (date, nullable) + `printed_date_type` (`expiry`|`best_before`, nullable).
  - `purchased_at` (date, def. hoy).
  - `cooked_at` (date, tápers).
  - `frozen_at`, `thawed_at` (date, nullable).
  - `reminder_date` (date, nullable) — fecha de aviso del lote (congelado, descongelado, táper o `bulk` abierto).
  - `container_number` (int, nullable) — solo tápers. Número para escribir en la tapa e identificar el recipiente físico. Único entre los tápers activos de la casa; al crear un táper se asigna **el número libre más bajo** (los números se reutilizan al vaciarse), editable.
  - `opened_at` (date, nullable) — solo para `bulk`/`count` cuando se quiera marcar como abierto.
  - `source` (`manual`|`ticket`|`barcode`|`recipe`|`move`).
  - Un lote con `quantity = 0` y sin unidades abiertas se elimina (o se archiva, ver `date_samples`).
- **`opened_units`** (solo `divisible`): `lot_id`, `remaining_fraction` (0–1), `opened_at`, `reminder_date` (nullable).
- **`date_samples`**: `house_id`, `product_id`, `days_to_printed_date` (int), `printed_date_type`, `created_at`. Se inserta al crear un lote con `printed_date` y `purchased_at`. Sirve para sugerir fechas aprendidas (§7.4). Sobrevive aunque el lote se consuma.
- **`ticket_aliases`**: `house_id`, `raw_text_normalized`, `product_id`, `brand`. Recuerda que "LECHE SEMI HACEND 1L" = Leche (Hacendado).

### 5.4 Historial

- **`movements`**: `house_id`, `type`, `product_name` (copia, para que el historial no se rompa si se borra el producto), `details jsonb` (cantidad y unidad, para mostrarlas en el idioma de cada persona; zona, casa destino/origen), `undo_state jsonb` (**estado previo** para poder deshacer; no legible desde el cliente), `created_at`.
  - Tipos: `added`, `consumed`, `opened`, `adjusted`, `finished`, `moved_zone`, `moved_out`, `moved_in`, `frozen`, `thawed`, `discarded`, `cooked`, `ticket_applied`.
  - **Sin `user_id`** (principio 5).
  - Un movimiento entre casas genera `moved_out` en la origen y `moved_in` en la destino.

### 5.5 Fases posteriores

- **`push_subscriptions`** (fase 3): `user_id`, `endpoint`, `p256dh`, `auth`, `user_agent`.
- **`shelf_life_guide`** (fase 3): `catalog_item_id` o `category`, `state` (`opened`|`frozen`|`thawed`|`cooked`|`closed_fridge`|`closed_pantry`), `min_days`, `max_days`, `note_es`, `note_en`, `source`.
- **`shopping_items`** (fase 6): `house_id`, `product_id` (nullable), `name`, `quantity_text`, `preferred_brand`, `checked`, `origin` (`manual`|`finished`|`recipe`).
- **`recipe_favorites`** (fase 7): `user_id`, `house_id`, `title`, `recipe jsonb`.
- **`recipe_blocked`** (fase 7): `user_id`, `title_normalized`.

### 5.6 Seguridad (RLS)

- Un usuario solo ve y edita filas de casas donde es miembro.
- Solo el `owner` puede renombrar o borrar la casa, generar invitaciones y expulsar miembros. Un editor puede salir de la casa.
- `catalog_items` y `shelf_life_guide`: lectura para usuarios autenticados, sin escritura desde el cliente.
- Favoritos, bloqueadas, preferencias y suscripciones push: solo su propio usuario.

### 5.7 Operaciones (funciones RPC en Postgres)

Todas validan pertenencia a la casa, son atómicas, registran un `movement` y devuelven su `id`.

| Función | Qué hace |
|---|---|
| `create_house(name)` | Crea la casa con sus 3 zonas, hace propietario a quien la crea y la deja activa. No registra movimiento |
| `add_lot(...)` | Crea lote (y producto si no existe) + `date_samples` |
| `add_cooked_dish(...)` | Crea un táper: producto propio, lote y número de recipiente. Registra `cooked` |
| `consume(product_id \| lot_id, amount, zone_id?, all?)` | Resta aplicando FEFO; para `divisible`, primero termina unidades abiertas, después abre/cuenta cerradas según la acción. Con `zone_id` se limita a esa zona. Si piden más de lo que queda, consume lo que hay |
| `open_unit(lot_id \| product_id, reminder_date?)` | Pasa una unidad cerrada a abierta (100 %). En `count` separa la unidad en un lote propio; en `bulk` marca el lote entero |
| `set_remaining(opened_unit_id, fraction)` | Ajusta lo que queda; si llega a 0, la elimina (`finished`) |
| `update_opened_unit(opened_unit_id, ...)` | Edita las fechas de una unidad abierta. Registra `adjusted` |
| `adjust_quantity(lot_id, new_quantity)` | Corrección manual (único caso en que se envía un valor final; registra `adjusted`) |
| `update_lot(lot_id, ...)` | Edita los datos del lote: fechas (incluidas `frozen_at`, `thawed_at` y `reminder_date`), tipo de fecha, marca y número de recipiente. Registra `adjusted` |
| `move_lot(lot_id, quantity, target_zone_id, opened_unit_ids?, reminder_date?)` | Mueve entre zonas o casas (entre casas, en la fase 2). Si se mueve parte, divide el lote conservando fechas y marca. Mover al Congelador es congelar (`frozen`, fija `frozen_at`) y sacarlo es descongelar (`thawed`, fija `thawed_at`). Entre casas, empareja el producto destino por `catalog_item_id` o nombre normalizado; si no existe, lo crea |
| `discard(lot_id, quantity, opened_unit_ids?)` | Tirar (distinto de consumir) |
| `update_product(product_id, ...)` / `delete_product(product_id)` | Editan nombre, categoría, marca preferida y notas, o borran un producto sin existencias. No cambian el inventario, así que no registran movimiento |
| `apply_ticket(payload)` | Aplica las líneas confirmadas de la preview y guarda alias |
| `cook_recipe(payload)` | Aplica los descuentos confirmados y, opcionalmente, crea táper |
| `undo_movement(movement_id)` | Restaura el estado previo guardado en `details`. Solo movimientos de los últimos 2 minutos. Se rechaza si un movimiento posterior tocó los mismos lotes, para no pisar el cambio de otra persona. Si se deshace, el movimiento desaparece del historial |

---

## 6. Navegación y pantallas

**Cabecera:** selector de casa activa (nombre + desplegable) y engranaje de Ajustes.

**Barra inferior:**
1. **Inventario**
2. **Avisos** (fase 3)
3. **＋** botón central: Añadir manualmente · Escanear código (fase 4) · Escanear ticket (fase 4)
4. **Compra** (fase 6)
5. **Recetas** (fase 7)

Las pestañas de fases futuras no se muestran hasta implementarse.

**Ajustes:** perfil, idioma, casas (crear, renombrar, invitar, unirse con código, miembros, salir), notificaciones, preferencias de recetas (fase 7), **Conservación y seguridad** (fase 3), **Movimientos** de la casa activa, **Mis datos** (exportar todo a JSON y eliminar la cuenta, fase 2), cerrar sesión.

Al eliminar la cuenta: las casas donde el usuario es el único miembro se borran; en las compartidas, si era `owner`, la propiedad pasa al miembro más antiguo.

### 6.1 Inventario

- Pestañas de zona: **Todo · Frigo · Congelador · Despensa**, y filtro **Restos** (tápers).
- Buscador arriba (difusa, ignora tildes, mayúsculas y plurales simples; busca también en sinónimos del catálogo).
- Orden: **fecha más próxima** (por defecto) · nombre · categoría.
- Vista **lista** (fase 1) y **tarjetas** 1 o 2 columnas (fase 5). La elección se recuerda.
- **Fila de producto:** icono · nombre · resumen de cantidad · fecha efectiva más próxima con color.
  - Ejemplos de resumen: "5 bricks + 1 abierto (60 %)", "12 huevos", "1,2 kg", "3 raciones".
  - Los tápers muestran su número de recipiente de forma destacada ("#3 Lentejas").
  - **No muestra la marca.**
- Gesto o botón rápido **−1** en la fila (aplica FEFO).
- Estado vacío amable con botón para añadir.

### 6.2 Detalle de producto

- Cabecera: icono/foto, nombre, categoría, total.
- **Lotes agrupados por fecha**, cada uno con: fecha y tipo, zona, cantidad, **marca** (aquí sí), estado congelado/descongelado.
- **Unidades abiertas** dentro de su lote, con slider rápido (¼ · ½ · ¾ · vacío) y cantidad exacta opcional.
- Acciones por lote: −1 · Abrir uno · Ajustar · Mover (zona o casa) · Congelar / Descongelar · Tirar · Editar.
- Sección **Marca preferida** y **notas de marca**, editables.
- Botón "Se ha acabado → añadir a la lista" (fase 6).

### 6.3 Añadir manualmente

1. Buscar en productos de la casa y en el catálogo base (o crear uno nuevo).
2. Cantidad según tipo (con valores por defecto del catálogo).
3. Zona (por defecto la del catálogo). Un lote añadido directamente al Congelador cuenta como congelado (`frozen_at` = hoy) y todas sus fechas se pueden editar.
4. Fecha impresa + tipo (caducidad / consumo preferente). **Vacía**, con chip aprendido si existe (§7.4) y botón **"Leer fecha con la cámara"** (fase 4, §10.2). Si se indica fecha, el tipo es obligatorio y no viene preseleccionado.
5. Marca (opcional, plegada bajo "Más detalles").
6. Botón "Escanear código de barras" para autocompletar (fase 4).

Para tápers: nombre libre, raciones, fecha de cocinado (hoy por defecto), zona, **número de recipiente** (asignado automáticamente, con el texto "Escríbelo en la tapa") y chip orientativo de fecha de aviso (fase 3). Cada táper es una fila propia del inventario; mover solo una parte crea otro táper con un número nuevo.

La fecha de aviso se puede poner a mano y es opcional, al abrir y en tápers, también antes de que existan los chips.

### 6.4 Movimientos

Lista cronológica de la casa activa agrupada por día: "Se añadieron 6 bricks de Leche (Frigo)", "Se consumió 1 brick de Leche", "Se movieron 3 bricks de Leche a Casa de la playa", "Se congeló Pollo", "Se tiró Yogur". Sin nombres de personas.

### 6.5 Deshacer

Tras cualquier acción que modifique el inventario, aparece un aviso inferior de unos 5 segundos con **Deshacer**, que llama a `undo_movement`.

---

## 7. Reglas de negocio

### 7.1 Consumir (FEFO)

- `−1` sobre un producto resta del lote con fecha efectiva más próxima (sin fecha = al final).
- En `divisible`, "−1" significa **terminar una unidad**: si hay una abierta, se termina esa; si no, se resta una cerrada.
- En `bulk`, "−1" abre una hoja pequeña para indicar la cantidad consumida, con un botón "Todo".
- "Abrir uno" abre una unidad del lote más próximo a caducar.
- Puede haber varias unidades abiertas a la vez.

### 7.2 Fecha efectiva y estado

Para cada lote/unidad se calcula una **fecha efectiva**:
- Unidad abierta → su `reminder_date` si existe; si no, la `printed_date` del lote. Si tiene `reminder_date` y la `printed_date` de tipo `expiry` es anterior, manda la `printed_date`.
- Lote `bulk` o `count` abierto → igual que una unidad abierta, con el `reminder_date` del lote.
- Lote congelado (sin descongelar) → `reminder_date` si existe; si no, **sin fecha** (se muestra "Congelado desde dd/mm").
- Lote descongelado → `reminder_date` si existe; si no, la `printed_date`.
- Táper → `reminder_date`.
- Resto → `printed_date`.

Estado y color:
- **Caducado** (rojo): fecha efectiva < hoy y (tipo `expiry` o es `reminder_date`).
- **Revisar** (amarillo): `printed_date` de tipo `best_before` < hoy. Texto: "Pasado el consumo preferente: revisa antes de consumir".
- **Pronto** (naranja): fecha efectiva ≤ hoy + `notify_days_ahead`.
- **OK** (neutro).

Una fila de producto con varios lotes muestra el estado más grave y su fecha (Caducado > Revisar > Pronto > OK).

Implementarlo una sola vez (vista SQL o función compartida) y usarlo en inventario, avisos y notificaciones.

### 7.3 Chips orientativos (fase 3)

Al abrir, congelar, descongelar o crear un táper, se muestra un chip según `shelf_life_guide`, p. ej. "Orientativo: consumir en 3–4 días". Un toque fija `reminder_date = hoy + max_days`; otro toque lo quita. Sin tocar, queda vacío.

### 7.4 Fechas aprendidas (fase 4)

- Para un producto con **≥ 3** `date_samples` del mismo tipo, sugerir `hoy + mediana(días)` como chip: "¿20 nov? (como sueles)".
- Aparece en el alta manual y en la preview del ticket. Nunca rellena el campo.
- Estadística simple, sin LLM.

### 7.5 Movimiento entre casas

- Se elige casa destino, zona y cantidad.
- Se conserva la fecha, el tipo de fecha, la marca y el estado (congelado, abierto).
- Requiere ser miembro de ambas casas.

---

## 8. Avisos de caducidad (fase 3)

- **Pantalla Avisos:** secciones *Caducado* · *Revisar* · *Pronto* · *Abiertos* (con días desde la apertura), con acciones rápidas (consumir, tirar, ir al detalle).
- **Notificación push diaria** a **todos los miembros** de la casa con `notify_enabled = true`, a su `notify_hour` local.
  - Una sola notificación por casa y día, con resumen: "Casa · 2 caducan hoy, 3 en los próximos 2 días". Al pulsarla, abre la pantalla Avisos de esa casa.
  - No enviar si no hay nada que avisar.
- Implementación: `pg_cron` cada hora → Edge Function `daily-digest` que selecciona los usuarios cuya hora local coincide y envía Web Push.
- En Ajustes: activar/desactivar, hora, días de antelación, botón "Enviar notificación de prueba".
- Explicar en la app que en iPhone hay que tenerla instalada en la pantalla de inicio para recibir avisos.

---

## 9. Conservación y seguridad (fase 3)

Sección informativa dentro de Ajustes (y enlazada desde los chips y desde la pantalla Avisos), en español e inglés.

**Contenido:**
1. **Temperaturas recomendadas** de frigorífico y congelador.
2. **Las fechas que importan:** caducidad, consumo preferente, después de abrir y fecha de congelación. Qué significa cada una y qué hacer cuando vence.
3. **Congelar y descongelar:** buenas prácticas, no recongelar lo descongelado, cómo descongelar de forma segura.
4. **Organización de la nevera** y separación de crudos y cocinados.
5. **Tiempos orientativos de conservación** por tipo de alimento (frigo cerrado, abierto, congelado, cocinado). Es la misma información que alimenta `shelf_life_guide`.
6. **Fuentes y actualización:** AESAN (aesan.gob.es), FoodSafety.gov y USDA FSIS (incluida su guía FoodKeeper), con la fecha de la última consulta.

**Reglas:**
- Redactar a partir de las fuentes oficiales, guardando en el repo las URL consultadas y la fecha (`src/content/conservation/SOURCES.md`).
- Si una cifra no se puede respaldar con una fuente, no se incluye.
- Marcar todo el contenido como **PENDIENTE DE REVISIÓN** hasta que el propietario lo confirme.
- Contenido en archivos de datos (JSON/Markdown) separados del código, para poder actualizarlo sin tocar componentes.
- Aviso visible: la información es orientativa y no sustituye a la etiqueta del producto.

---

## 10. Escaneo de ticket y lectura de fechas (fase 4)

### 10.1 Flujo del ticket
1. Foto con la cámara o desde la galería. Comprimir en el cliente (lado largo ~1600 px, JPEG).
2. Edge Function `parse-receipt` → modelo multimodal. Se le envía la imagen y la lista de productos y alias de la casa para facilitar el emparejamiento.
3. Respuesta en **JSON estructurado y validado** (Zod o similar):
   ```json
   {
     "store": "string|null",
     "date": "YYYY-MM-DD|null",
     "lines": [{
       "raw_text": "LECHE SEMI HACEND 1L",
       "name": "Leche semidesnatada",
       "matched_product_id": "uuid|null",
       "brand": "Hacendado|null",
       "is_food": true,
       "quantity": 6,
       "quantity_kind": "divisible",
       "unit_label": "brick",
       "content_amount": 1,
       "content_unit": "l",
       "suggested_zone": "fridge"
     }]
   }
   ```
   El modelo **no** devuelve fechas de caducidad.
4. **Preview** editable:
   - Casa destino (por defecto la activa).
   - Por línea: casilla (desmarcada si `is_food = false`), nombre, producto emparejado (cambiable), cantidad, zona, marca, **fecha vacía** + chip aprendido (§7.4), botón **"Escanear código de barras"** para autocompletar nombre, marca y foto.
   - Añadir línea a mano y eliminar líneas.
   - Botón **"Escanear fechas en cadena"** (§10.3).
5. Confirmar → `apply_ticket` → guarda alias (`ticket_aliases`) para próximos tickets.
6. Si existe lista de la compra (fase 6), marcar como compradas las líneas que coincidan.

**Errores:** si la lectura falla o devuelve JSON inválido, mostrar mensaje claro y permitir reintentar o pasar a alta manual. Controlar tamaño máximo de imagen.

### 10.2 Leer fecha con la cámara

- Foto (o recorte) de la zona del envase donde está impresa la fecha.
- Edge Function `read-date` → modelo multimodal. Devuelve `{ "date": "YYYY-MM-DD|null", "date_type": "expiry|best_before|null", "raw_text": "...", "confidence": "high|low" }`.
  - `expiry` si el texto indica caducidad ("fecha de caducidad", "consumir antes del"); `best_before` si indica consumo preferente ("consumir preferentemente antes del"). Si no se puede saber, `null` y el usuario elige.
  - Fechas incompletas (solo mes/año, habitual en conservas): usar el último día del mes e indicarlo.
- **Siempre se confirma antes de guardar:** se muestra la fecha leída en grande, con el texto reconocido debajo, y botones *Confirmar* · *Corregir* · *Repetir foto*. Si `confidence = low`, se resalta.
- Disponible en: alta manual, edición de lote y preview del ticket.

### 10.3 Escaneo de fechas en cadena

Para completar las fechas de un ticket sin ir línea a línea a mano:
1. Desde la preview, "Escanear fechas en cadena" recorre las líneas marcadas que no tienen fecha.
2. Para cada una muestra el nombre del producto ("Ahora: Leche semidesnatada · 3 de 9") con la cámara abierta.
3. Foto → lectura (§10.2) → *Confirmar* pasa automáticamente a la siguiente; *Saltar* la deja vacía.
4. Si una línea tiene varias unidades, la fecha se aplica a todo el lote; desde la preview se puede dividir en dos lotes con fechas distintas.
5. Al terminar (o al salir), vuelve a la preview con las fechas rellenas, todavía editables antes de confirmar el ticket.

---

## 11. Código de barras (fase 4)

- Escáner con `@zxing/browser` en una hoja inferior con vista de cámara.
- Consulta a Open Food Facts por código → nombre, marca, formato/cantidad, foto.
- Si no hay resultado: permitir rellenar a mano y guardar igualmente el código en el lote.
- Guardar `barcode` e `image_url` en el lote.
- Disponible desde: alta manual, preview del ticket y detalle de lote ("Asignar código").

---

## 12. Vista de tarjetas (fase 5)

- Interruptor **Lista / Tarjetas** y, en tarjetas, **1 / 2 columnas**. Se recuerda la elección.
- **Imagen de la tarjeta:** foto del **lote con fecha efectiva más próxima** → si no tiene, foto del producto → si no, icono del catálogo o genérico por categoría.
- Si el producto tiene lotes de **varias marcas**, indicador pequeño "+N" en la esquina.
- En el **detalle**, carrusel deslizable con las fotos de cada marca.
- La tarjeta muestra: imagen, nombre, resumen de cantidad, chip de estado/fecha. Sin texto de marca.
- Imágenes de Open Food Facts por URL; fotos propias en Supabase Storage (comprimidas).

---

## 13. Lista de la compra (fase 6)

- Una lista por casa, compartida y en tiempo real.
- Elemento: nombre, cantidad libre, **marca preferida** (visible aquí), casilla.
- Orígenes:
  - Manual.
  - Al terminar la última unidad de un producto: aviso "¿Añadir a la lista?".
  - Desde recetas (ingredientes que faltan).
- "Borrar comprados".
- Al aplicar un ticket, las líneas emparejadas se marcan como compradas.

---

## 14. Recetas con IA (fase 7)

**Pantalla Recetas:**
- Slider de 3 posiciones: **Vaciar la nevera** · **Equilibrado** · **Inspiración libre**.
- Filtro opcional: chips (Pasta, Arroz, Legumbres, Ensalada, Carne, Pescado, Verdura, Cena ligera, Postre) + texto libre.
- Personas y tiempo máximo (opcionales).
- Botón "Sugerir".

**Edge Function `suggest-recipes`:**
- Entrada: inventario de la casa activa (nombre, cantidad, fecha efectiva, priorizando lo que caduca antes), modo del slider, filtros, `recipe_preferences` del usuario, títulos de sus últimos favoritos (máx. 10) y títulos bloqueados.
- Salida JSON validado: 3 recetas con `title`, `time_minutes`, `servings`, `ingredients[{name, amount_text, have, matched_product_id}]`, `steps[]`, `uses_expiring[]`.

**Acciones por receta:**
- ♥ **Favorito** (lista de Favoritos accesible desde la pantalla).
- **No me la vuelvas a sugerir.**
- **Añadir lo que falta a la lista** (fase 6).
- **He cocinado esto:**
  1. Preview editable de lo que se va a descontar (FEFO; cantidades editables; quitar líneas).
  2. Confirmar → `cook_recipe`.
  3. Pregunta "¿Te han sobrado raciones?" → crea táper con raciones, zona y chip de fecha.

**Preferencias:** texto libre editable en Ajustes ("no me gusta el cilantro", "intento comer menos carne roja"). Sin valoraciones con estrellas.

**Aviso visible** en la pantalla de recetas: las propuestas son generales y hay que comprobar ingredientes, alergias y preparación, especialmente en situaciones como el embarazo. La app no determina si un alimento es seguro.

---

## 15. Búsqueda semántica (fase 8)

- Solo si la búsqueda difusa se queda corta en el uso real.
- Embeddings por producto (nombre + sinónimos) en `pgvector`, calculados al crear o renombrar.
- Búsqueda híbrida: primero Fuse.js; si hay pocos resultados o de baja puntuación, consulta semántica.
- **Antes de implementar**, proponer al propietario el proveedor o modelo de embeddings (multilingüe, coste, latencia) y esperar su elección.

---

## 16. Internacionalización

- Archivos `src/locales/es.json` y `src/locales/en.json`.
- Idioma por defecto según el navegador; cambiable en Ajustes y guardado en `profiles.locale`.
- Se traducen la interfaz, el catálogo base (`name_es`/`name_en`) y el contenido de Conservación.
- Los nombres que escribe el usuario no se traducen.
- Fechas y números con formato según idioma.

---

## 17. Fases

Cada fase termina con la app desplegada y funcionando. **No empezar la siguiente sin confirmación del propietario.**

### Fase 0 · Base
- Proyecto Vite + React + TS + Tailwind, PWA instalable (iconos, manifest, splash), i18n ES/EN.
- Supabase: proyecto, migraciones en `supabase/migrations`, Auth (email + contraseña, sin enlace mágico: en iPhone abriría Safari y no la app instalada).
- Despliegue en GitHub Pages con GitHub Actions.
- `SETUP.md`: guía paso a paso para el propietario (trabaja en Windows y no ha configurado antes Supabase ni despliegues): crear proyecto en Supabase, aplicar migraciones, variables de entorno, secretos, activar GitHub Pages, instalar la PWA en iPhone y Android.
- **Aceptación:** puedo registrarme, iniciar sesión, cambiar idioma e instalar la app en el iPhone.

### Fase 1 · Inventario
- Crear una casa (con sus 3 zonas) en una pantalla única tras el primer inicio de sesión, con "Casa" como nombre propuesto. En la fase 2 esa pantalla añade "Unirme con código".
- Catálogo base sembrado.
- Productos, lotes, tipos de cantidad, fecha impresa + tipo, unidades abiertas, tápers con número de recipiente.
- Consumir (FEFO), abrir, ajustar, terminar, tirar, mover entre zonas.
- Congelar / descongelar con fechas (adelantado desde la fase 2).
- Marcas ocultas en la lista; marca preferida y notas.
- Vista lista, filtros por zona y Restos, orden, búsqueda difusa.
- Estado y colores (§7.2, sin chips todavía).
- Movimientos y Deshacer.
- **Aceptación:** puedo registrar "6 bricks del 1/10" y "6 bricks del 1/11", abrir uno, dejarlo al 60 %, consumir y ver los totales correctos; buscar "lehce" encuentra Leche.

### Fase 2 · Casas compartidas
- Crear varias casas, renombrar, borrar (owner).
- Invitar con código/enlace, unirse, roles, salir, expulsar.
- Tiempo real (Supabase Realtime) en inventario y movimientos.
- Mover entre casas (con división de lotes y emparejamiento de productos).
- SMTP propio para que todos los miembros reciban los emails de recuperación de contraseña.
- Consulta sin conexión (solo lectura).
- Mis datos: exportar a JSON y eliminar cuenta.
- **Aceptación:** dos móviles con cuentas distintas ven el mismo cambio en segundos; restar a la vez desde ambos deja la cantidad correcta.

### Fase 3 · Avisos y conservación
- Pantalla Avisos.
- Web Push: suscripción, `daily-digest` con `pg_cron`, ajustes, notificación de prueba.
- Sección Conservación y seguridad con fuentes (§9).
- `shelf_life_guide` y chips orientativos al abrir, congelar, descongelar y crear táper.
- **Aceptación:** recibo en el iPhone la notificación diaria a la hora elegida; los chips proponen plazos y no rellenan nada sin tocarlos.

### Fase 4 · Ticket y código de barras
- Escáner de códigos + Open Food Facts.
- Escaneo de ticket con preview completa (§10) y alias.
- Leer fecha con la cámara (§10.2) y escaneo de fechas en cadena (§10.3).
- Fechas aprendidas (§7.4).
- **Aceptación:** escaneo un ticket real de supermercado, corrijo dos líneas, desmarco el detergente, relleno las fechas con el escaneo en cadena y todo se añade correctamente; en el segundo ticket la leche se empareja sola.

### Fase 5 · Tarjetas con foto
- Vista de tarjetas 1/2 columnas, imágenes, "+N" y carrusel en detalle (§12).

### Fase 6 · Lista de la compra
- §13 completa.

### Fase 7 · Recetas
- §14 completa.

### Fase 8 · Búsqueda semántica
- §15, previa elección del proveedor de embeddings.

---

## 18. Fuera de alcance

- Publicación en App Store / Google Play.
- Historial con nombres de usuario.
- Edición sin conexión con sincronización posterior.
- Precios, gastos o estadísticas de compra.
- Valoraciones con estrellas de recetas.
- Chat entre miembros.

---

## 19. Forma de trabajar

- Mantener una sección **"Estado"** al final de este archivo (o `PROGRESS.md`) con lo hecho, lo pendiente y las decisiones tomadas.
- Migraciones de base de datos versionadas; nunca cambios manuales en producción sin migración.
- Tipos de TypeScript generados desde el esquema de Supabase.
- Tests al menos para: cálculo de fecha efectiva y estado, FEFO, división de lotes al mover, asignación de número de táper, fechas aprendidas y validación de respuestas de la IA.
- Ante cualquier ambigüedad del SPEC: preguntar, no suponer.
- Los commits y el push los hace el propietario. Claude propone el commit al final de cada fase.

---

## Estado

**Fase actual:** 1 · Inventario. Código terminado, pendiente de aplicar las migraciones, desplegar y confirmar en el iPhone.

### Hecho

**Fase 1 · Inventario**

- Casas, zonas y pantalla de bienvenida para crear la primera casa.
- Catálogo de 197 alimentos en `supabase/seed/catalog.json`; `npm run catalog:migration` lo convierte en migración.
- Productos, lotes, tipos de cantidad, fecha impresa y tipo, unidades abiertas y tápers con número de recipiente.
- Consumir (FEFO), abrir, ajustar, terminar, tirar, mover entre zonas, congelar y descongelar, todo con funciones atómicas.
- Vista lista, filtros por zona y Restos, orden, búsqueda difusa, estado y colores.
- Detalle de producto, marca preferida y notas, renombrar y eliminar.
- Movimientos agrupados por día y Deshacer.
- Tests contra Postgres real: fecha efectiva, FEFO, división de lotes, números de táper, Deshacer y permisos.

**Fase 0 · Base (confirmada)**

- Proyecto Vite + React + TypeScript + Tailwind con modo oscuro y zonas seguras.
- PWA instalable: manifest, service worker, iconos y pantallas de arranque de iPhone en claro y oscuro.
- i18n ES/EN con claves tipadas. El linter rechaza textos escritos a mano en los componentes.
- Auth con email y contraseña: registro, inicio y cierre de sesión, recuperación de contraseña.
- Ajustes: perfil, idioma guardado en `profiles.locale` y cerrar sesión.
- Migración de `profiles` con RLS, `GRANT` explícitos y creación automática al registrarse.
- Despliegue con GitHub Actions y guía en `SETUP.md`.
- Tests: migraciones y RLS contra Postgres real (PGlite, sin Docker), traducciones y errores de Auth.

### Pendiente

- **Fase 1:** aplicar las migraciones, publicar y comprobar la aceptación en el iPhone. El recorrido se ha probado contra el SQL real, pero con la API de Supabase emulada y en Edge.
- **Fase 2:** sin empezar, a la espera de confirmación del propietario.
- **Para la fase 2:** con varias casas, el selector de la cabecera; moverse entre casas ya está previsto en `move_lot`.
- **Para la fase 3:** el aviso real de `reminder_date`; hasta entonces solo afecta al color y al orden.

### Decisiones tomadas (2026-11-09)

Ya incorporadas en las secciones correspondientes del SPEC, salvo las que solo aparecen aquí:

- **Registro:** confirmación por email desactivada. El registro se abre solo mientras se da de alta la familia y luego se cierra desde Supabase. El email integrado de Supabase solo llega a miembros del equipo (2 por hora), así que el SMTP propio llega en la fase 2.
- **Hosting:** repo público, porque GitHub Pages gratis lo exige. No contiene secretos.
- **Claves de Supabase:** `publishable` y `secret`.
- **Nombre:** "Nevera digital" ("Digital Fridge" en inglés), "Nevera" bajo el icono. Icono provisional.
- **Lotes idénticos:** se fusionan si coinciden en producto, zona, fecha, tipo de fecha, marca y estado.
- **Productos sin existencias:** salen del inventario, pero siguen en el buscador de Añadir con su marca y sus notas.
- **Idioma del catálogo:** cada persona ve los productos del catálogo en su idioma, salvo que se hayan renombrado.
- **Catálogo:** el script convierte el JSON en una migración, así no hace falta usar claves secretas para cargarlo.
- **Permisos en Supabase:** cada migración declara sus `GRANT`, porque los proyectos nuevos ya no exponen las tablas automáticamente.
- **Enlaces de email:** flujo `implicit` de Supabase Auth, porque con PKCE la recuperación de contraseña fallaría al pedirla desde la app instalada y abrir el enlace en Safari.
- **TypeScript 6:** el linter (`typescript-eslint`) todavía no soporta la versión 7.
- **`npm audit`:** avisos moderados y bajos solo en herramientas de desarrollo (`eslint`, `workbox-build`). No llegan al móvil, y el arreglo automático bajaría versiones mayores, así que se dejan como están.
- **Estado y fecha efectiva:** la fecha efectiva se calcula en SQL, porque FEFO la necesita en el servidor. El estado (colores) se calcula en `src/domain/status.ts`, porque depende del día de hoy y debe ser correcto sin conexión. Cada regla está implementada una sola vez.
- **Escrituras:** el cliente solo lee las tablas. Todo cambio del inventario pasa por funciones, que bloquean la fila del producto para que dos personas no se pisen.
- **Productos del catálogo:** al añadirlos, cómo se cuentan va plegado en "Más detalles", porque los valores por defecto suelen servir.
- **Eliminar producto:** solo sin existencias, desde su detalle. No estaba en el SPEC, pero sin ello una errata al crear un producto se quedaría para siempre en el buscador de Añadir.
