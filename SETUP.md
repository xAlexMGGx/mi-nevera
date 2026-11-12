# Guía de configuración · Nevera digital

Esta guía recoge todo lo que tienes que hacer tú: crear la base de datos, configurar GitHub y publicar la app. Todos los comandos son para **PowerShell**, desde la carpeta del proyecto (en VS Code: menú *Terminal → New Terminal*).

Calcula unos 30 minutos. Ya tienes instalados Node y Git, así que no necesitas instalar nada más.

**Qué vas a hacer:**

1. Crear el proyecto en Supabase
2. Configurar el inicio de sesión
3. Copiar dos valores de Supabase
4. Crear el archivo `.env.local`
5. Crear las tablas en la base de datos
6. Probar la app en tu ordenador
7. Configurar GitHub
8. Publicar la app
9. Instalar la app en el móvil
10. Cerrar el registro (más adelante)
11. Enviar los correos con tu Gmail
12. Activar las notificaciones
13. Activar la lectura con IA (tickets y fechas)

Tu app quedará publicada en **https://xalexmggx.github.io/mi-nevera/**.

---

## 1. Crear el proyecto en Supabase

Supabase es el servicio que guarda los datos y gestiona las cuentas de usuario. El plan gratuito es suficiente.

1. Entra en <https://supabase.com/dashboard> y crea una cuenta. Lo más cómodo es **Continue with GitHub**.
2. Si te pide crear una organización, ponle cualquier nombre y elige el plan **Free**.
3. Pulsa **New project** y rellena:
   - **Name:** `nevera-digital`
   - **Database Password:** pulsa *Generate a password* y guárdala en tu gestor de contraseñas. No la necesitarás a diario.
   - **Region:** una de Europa, por ejemplo París o Fráncfort.
4. Si ves opciones de seguridad o de **Data API**, deja el Data API activado y el resto como venga.
5. Pulsa **Create new project** y espera un par de minutos a que termine.

---

## 2. Configurar el inicio de sesión

**Desactivar la confirmación por email**

El email integrado de Supabase solo llega a los miembros de tu equipo de Supabase, con un máximo de 2 correos por hora. Por eso no se pide confirmar el correo al registrarse.

1. Abre **Authentication → Sign In / Providers → Email**.
2. Desactiva **Confirm email** y guarda.

**Indicar la dirección de la app**

1. Abre <https://supabase.com/dashboard/project/_/auth/url-configuration> y elige tu proyecto.
2. En **Site URL** escribe `https://xalexmggx.github.io/mi-nevera/` y guarda.
3. En **Redirect URLs** pulsa *Add URL* y añade estas dos:
   - `https://xalexmggx.github.io/mi-nevera/`
   - `http://localhost:5173/**`

---

## 3. Copiar dos valores de Supabase

Anótalos en un bloc de notas, porque los vas a usar en los pasos 4, 5 y 7.

| Valor | Dónde está | Aspecto |
|---|---|---|
| **Project ID** | **Project Settings → General** | 20 letras, como `abcdefghijklmnopqrst` |
| **Publishable key** | **Project Settings → API Keys** | Empieza por `sb_publishable_` |

Si no ves ninguna clave `sb_publishable_`, pulsa el botón para crear las claves nuevas.

La URL de tu proyecto es `https://TU-PROJECT-ID.supabase.co`.

> ⚠️ **No copies nunca la clave `sb_secret_`** en el proyecto ni en un chat: da acceso total a la base de datos. Las claves `sb_publishable_` sí pueden ser públicas, porque las reglas de la base de datos deciden qué puede ver cada persona.

---

## 4. Crear el archivo `.env.local`

Este archivo le dice a la app qué proyecto de Supabase usar en tu ordenador. Git lo ignora, así que no se publica.

1. Créalo a partir de la plantilla:

   ```powershell
   Copy-Item .env.example .env.local
   code .env.local
   ```

2. Sustituye los valores de ejemplo por los tuyos y guarda:

   ```
   VITE_SUPABASE_URL=https://TU-PROJECT-ID.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_lo-que-hayas-copiado
   ```

---

## 5. Crear las tablas en la base de datos

Las tablas están definidas en `supabase/migrations`. Estos comandos las aplican a tu proyecto.

1. Conecta tu ordenador con tu cuenta de Supabase. Se abrirá el navegador para que lo autorices:

   ```powershell
   npx supabase login
   ```

2. Enlaza esta carpeta con tu proyecto, cambiando el texto por tu Project ID:

   ```powershell
   npx supabase link TU-PROJECT-ID
   ```

3. Aplica las migraciones. Confirma con `y` si te pregunta:

   ```powershell
   npm run db:push
   ```

4. Actualiza los tipos de TypeScript a partir de la base de datos real:

   ```powershell
   npm run db:types
   ```

Si algún comando te pide la contraseña de la base de datos, es la que guardaste en el paso 1.

**Compruébalo:** en Supabase, abre **Table Editor**. Debe aparecer la tabla `profiles`, todavía vacía.

---

## 6. Probar la app en tu ordenador

1. Arráncala:

   ```powershell
   npm run dev
   ```

2. Abre <http://localhost:5173/mi-nevera/>.
3. Pulsa **Crear cuenta** y regístrate con tu correo real. Esta cuenta ya es la definitiva, porque la app publicada usará esta misma base de datos.
4. Debería saludarte por tu nombre, y en **Table Editor → profiles** debe aparecer una fila.
5. Para parar la app, pulsa `Ctrl + C` en la terminal.

---

## 7. Configurar GitHub

Entra en <https://github.com/xAlexMGGx/mi-nevera/settings>.

**Activar GitHub Pages**

1. En el menú lateral, abre **Pages**.
2. En **Build and deployment → Source**, elige **GitHub Actions**.

**Añadir los dos valores de Supabase**

1. En el menú lateral, abre **Secrets and variables → Actions**.
2. Abre la pestaña **Variables** (no *Secrets*: estos dos valores son públicos).
3. Pulsa **New repository variable** y crea estas dos:

   | Name | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | `https://TU-PROJECT-ID.supabase.co` |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | Tu clave `sb_publishable_...` |

---

## 8. Publicar la app

Cada vez que subes cambios a `main`, GitHub comprueba el código y publica la app.

Usa los comandos de commit que te dé Claude al terminar cada fase. Antes de confirmar, ejecuta `git status` y comprueba que **`.env.local` no aparece en la lista**.

Para seguir la publicación:

1. Abre <https://github.com/xAlexMGGx/mi-nevera/actions>.
2. Espera a que el último proceso termine en verde. Tarda unos 2 minutos.
3. Abre <https://xalexmggx.github.io/mi-nevera/> y entra con tu cuenta.

---

## 9. Instalar la app en el móvil

La app se instala desde el navegador, sin pasar por ninguna tienda.

**iPhone**

1. Abre <https://xalexmggx.github.io/mi-nevera/> en **Safari**.
2. Pulsa **Compartir**. Si no lo ves en la barra, está en el menú **···** junto a la dirección.
3. Baja y pulsa **Añadir a pantalla de inicio**.
4. Si aparece **Abrir como app web**, déjalo activado.
5. Pulsa **Añadir**.

Ábrela desde el icono **Nevera** y vuelve a iniciar sesión: la app instalada no comparte la sesión con Safari.

**Android**

1. Abre la misma dirección en **Chrome**.
2. Abre el menú **⋮** y pulsa **Instalar app** o **Añadir a pantalla de inicio**.
3. Ábrela desde el icono **Nevera**.

---

## 10. Cerrar el registro (más adelante)

Mientras el registro esté abierto, cualquiera que encuentre la dirección puede crearse una cuenta. No vería tus datos, pero en las fases con IA podría gastar tu crédito.

Cuando estéis todos registrados:

1. Abre <https://supabase.com/dashboard/project/_/auth> y elige tu proyecto.
2. Desactiva **Allow new users to sign up** y guarda.

Si alguien más quiere entrar después, actívalo un momento. Hazlo como muy tarde antes de empezar la Fase 4, que es la primera con IA.

---

## 11. Enviar los correos con tu Gmail

El correo integrado de Supabase solo llega a los miembros de tu equipo de Supabase. Para que cualquiera de la familia pueda recuperar su contraseña, Supabase enviará los correos desde tu cuenta de Gmail. Es gratis y no necesitas un dominio propio. Calcula unos 10 minutos.

**Crear una contraseña de aplicación en Google**

Es una contraseña aparte que solo sirve para enviar correo. Tu contraseña de Google no sale de tu cuenta y puedes revocarla cuando quieras.

1. Necesitas tener activada la **verificación en dos pasos**. Si no la tienes, actívala en <https://myaccount.google.com/signinoptions/twosv>.
2. Abre <https://myaccount.google.com/apppasswords>.
3. En el nombre de la aplicación escribe `Nevera digital` y pulsa **Crear**.
4. Copia la contraseña de 16 letras que aparece. Solo se muestra una vez. Si la pierdes, borra esa y crea otra.

> Si no aparece la opción, puede ser porque tu verificación en dos pasos solo usa llaves de seguridad, porque la cuenta es de una empresa o un centro educativo, o porque tiene activada la Protección Avanzada. En ese caso, usa otra cuenta de Gmail personal.

**Configurar Supabase**

1. Abre <https://supabase.com/dashboard/project/_/auth/smtp> y elige tu proyecto. Es **Authentication → Emails → SMTP Settings**.
2. Activa **Enable custom SMTP** y rellena:

   | Campo | Valor |
   |---|---|
   | Sender email | Tu dirección de Gmail |
   | Sender name | `Nevera digital` |
   | Host | `smtp.gmail.com` |
   | Port number | `587` |
   | Username | Tu dirección de Gmail completa |
   | Password | La contraseña de aplicación de 16 letras, sin espacios |
   | Minimum interval between emails | Déjalo como venga |

3. Pulsa **Save changes**.

**Poner el correo en español (opcional)**

1. En **Authentication → Emails**, abre la pestaña **Templates** y elige **Reset Password**.
2. En **Subject** escribe `Recupera tu contraseña de Nevera digital`.
3. En el cuerpo, sustituye lo que haya por esto y guarda:

   ```html
   <h2>Recupera tu contraseña</h2>
   <p>Pulsa el enlace para elegir una contraseña nueva:</p>
   <p><a href="{{ .ConfirmationURL }}">Elegir contraseña nueva</a></p>
   <p>Si no lo has pedido tú, ignora este correo.</p>
   ```

**Compruébalo:** en la app, cierra sesión, pulsa **He olvidado mi contraseña** y escribe el correo de alguien de la familia que no esté en tu equipo de Supabase. Le debe llegar en un par de minutos. Mira también en spam.

Con el correo propio, Supabase permite unos 30 correos por hora, de sobra para una familia.

---

## 12. Activar las notificaciones

El aviso diario de caducidad lo envía Supabase cada hora en punto a quien tiene esa hora elegida. Necesita tres cosas: unas claves para firmar las notificaciones, dos pequeños programas en Supabase (Edge Functions) y una tarea programada. Calcula unos 15 minutos. Hazlo después de aplicar las migraciones de la Fase 3 (`npm run db:push`).

**1. Generar las claves de las notificaciones**

```powershell
npm run push:keys
```

Crea el archivo `supabase/.env.functions` con la clave secreta (Git lo ignora) y muestra una línea como `VITE_VAPID_PUBLIC_KEY=BK...`. Esa clave es pública.

> Genera las claves una sola vez. Si las cambias, cada persona tendrá que volver a activar las notificaciones en su móvil.

**2. Poner la clave pública en la app**

1. Añade la línea `VITE_VAPID_PUBLIC_KEY=...` que te ha mostrado al final de tu `.env.local`.
2. En GitHub, en **Settings → Secrets and variables → Actions → Variables**, crea la variable `VITE_VAPID_PUBLIC_KEY` con el mismo valor (lo que va después del `=`).

**3. Subir las claves secretas y las funciones a Supabase**

```powershell
npx supabase secrets set --env-file supabase/.env.functions
npm run functions:deploy
```

El segundo comando sube `daily-digest` (el aviso diario) y `send-test-push` (la notificación de prueba). Después puedes borrar `supabase/.env.functions`: las claves ya están en Supabase y no hacen falta en tu ordenador.

**4. Dar a la tarea programada lo que necesita para llamar al aviso diario**

La tarea se creó con las migraciones, pero necesita la dirección de tu proyecto y la clave secreta. Se guardan cifradas en el Vault de Supabase:

1. En Supabase, abre **Project Settings → API Keys** y copia la clave secreta (`sb_secret_...`) de la sección **Secret keys**. Pégala solo en el paso siguiente: nunca en el proyecto ni en un chat.
2. Abre el **SQL Editor**, pega esto sustituyendo los dos valores y pulsa **Run**:

   ```sql
   select vault.create_secret('https://TU-PROJECT-ID.supabase.co', 'project_url');
   select vault.create_secret('sb_secret_PEGA_AQUI_TU_CLAVE', 'secret_key');
   ```

**Compruébalo**

1. Publica la app (paso 8) y ábrela en el iPhone **desde el icono de la pantalla de inicio**: desde Safari no se pueden recibir notificaciones.
2. Ve a **Ajustes → Avisos y notificaciones**, pulsa **Activar en este móvil** y acepta el permiso.
3. Pulsa **Enviar notificación de prueba**. Debe llegarte en unos segundos.
4. Para el aviso diario, elige una hora que esté por llegar. Tras esa hora, en el **SQL Editor** puedes ver si la tarea se ejecutó:

   ```sql
   select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
   ```

   El aviso solo llega si hay algo caducado o a punto de caducar en alguna de tus casas.

---

## 13. Activar la lectura con IA (tickets y fechas)

Leer un ticket o la fecha de un envase lo hace Claude, el modelo de IA de Anthropic, desde dos funciones de Supabase (`parse-receipt` y `read-date`). La clave de Anthropic solo se guarda en Supabase: ni en el proyecto ni en el móvil. Calcula unos 10 minutos.

**Antes de empezar:**

- Cierra el registro (paso 10). Con el registro abierto, un desconocido podría gastar tu crédito.
- Aplica la migración de la Fase 4: `npm run db:push` y después `npm run db:types`.

**1. Crear la clave de Anthropic**

1. Entra en <https://console.anthropic.com> y crea una cuenta.
2. En **Billing**, añade crédito. Con 5 $ hay para empezar de sobra.
3. Pon un límite de gasto mensual bajo (por ejemplo, 10 $) en la página de límites de la consola. Así un fallo nunca puede costarte más que eso.
4. En **API Keys**, pulsa **Create Key** y llámala `Nevera digital`. Copia la clave (`sk-ant-...`): solo se muestra una vez. Pégala únicamente en el paso siguiente, nunca en el proyecto ni en un chat.

**2. Guardar la clave en Supabase**

Para que la clave no quede en el historial de PowerShell, va en un archivo temporal que Git ignora:

1. En VS Code, crea el archivo `supabase/.env.anthropic` con estas dos líneas, pegando tu clave:

   ```
   ANTHROPIC_API_KEY=sk-ant-PEGA_AQUI_TU_CLAVE
   ANTHROPIC_MODEL=claude-opus-5-5
   ```

2. Súbelo a los secretos de Supabase y borra el archivo:

   ```powershell
   npx supabase secrets set --env-file supabase/.env.anthropic
   Remove-Item supabase/.env.anthropic
   ```

**Qué modelo usar:** `claude-opus-5-5` es el más capaz y el que recomiendo para tickets arrugados o con poca luz. Si prefieres gastar menos, `claude-sonnet-5-5` cuesta la mitad. Para cambiarlo, repite este paso con el otro nombre; no hace falta tocar el código.

**3. Subir las funciones**

```powershell
npm run functions:deploy
```

Sube las cuatro funciones: las dos de notificaciones y las dos de lectura.

**Compruébalo**

1. En la app, pulsa **＋ → Escanear ticket**, haz una foto de un ticket y pulsa **Leer ticket**. En unos segundos aparece la lista para revisar.
2. Dentro de un producto, en **Editar** de un lote, prueba **Leer fecha con la cámara**.

**Lo que cuesta:** se paga por uso. Como orientación, con `claude-opus-5-5` un ticket cuesta unos céntimos y una fecha, alrededor de un céntimo; lo exacto lo ves en la consola de Anthropic, en **Usage**. Para evitar sorpresas, la app permite a cada persona 20 tickets y 150 fechas al día.

**Privacidad:** la foto se envía a Anthropic solo para leerla y no se guarda en ningún sitio. Los códigos de barras se consultan en Open Food Facts, una base de datos pública y gratuita, sin enviar nada tuyo.

---

## Trabajo habitual

**Cuando una fase incluye migraciones nuevas**, aplícalas antes de publicar el código:

```powershell
npm run db:push
npm run db:types
```

**Cuando una fase cambia las Edge Functions** (carpeta `supabase/functions`), súbelas otra vez:

```powershell
npm run functions:deploy
```

**Actualizar la app en el móvil:** se actualiza sola. Si no ves los cambios, ciérrala del todo y vuelve a abrirla, a veces dos veces.

## Qué es público y qué es secreto

| Dato | ¿Es secreto? | Dónde va |
|---|---|---|
| URL de Supabase | No | `.env.local` y Variables de GitHub |
| Clave `sb_publishable_` | No | `.env.local` y Variables de GitHub |
| Contraseña de la base de datos | **Sí** | Solo en tu gestor de contraseñas |
| Contraseña de aplicación de Gmail | **Sí** | Solo en Supabase, en SMTP Settings (paso 11) |
| Clave `sb_secret_` | **Sí** | Solo en el Vault de Supabase (paso 12) |
| Clave pública de notificaciones (`VITE_VAPID_PUBLIC_KEY`) | No | `.env.local` y Variables de GitHub (paso 12) |
| Claves secretas de notificaciones (`supabase/.env.functions`) | **Sí** | Solo en los secretos de Supabase (paso 12). Git ignora el archivo |
| Clave de Anthropic (`sk-ant-`) | **Sí** | Solo en los secretos de Supabase (paso 13) |
| Nombre del modelo (`ANTHROPIC_MODEL`) | No | En los secretos de Supabase, junto a la clave (paso 13) |

## Si algo falla

| Qué ves | Qué hacer |
|---|---|
| La app dice "Falta configurar Supabase" | Revisa `.env.local` (paso 4) y vuelve a lanzar `npm run dev`. |
| El proceso de GitHub falla en "Comprobar variables de Supabase" | Revisa las variables del paso 7 y pulsa **Re-run jobs** en esa ejecución. |
| La dirección de la app da error 404 | Comprueba que Pages usa **GitHub Actions** (paso 7) y que el proceso terminó en verde. |
| Te registras, pero no te saluda por tu nombre | Faltan las tablas: repite `npm run db:push` (paso 5). |
| `npm run db:types` falla y `src/lib/database.types.ts` queda vacío | Ejecuta `git checkout src/lib/database.types.ts` y vuelve a probar. |
| No llega el correo de recuperación | Revisa el spam. Si nunca llega, comprueba el paso 11: sin él, solo llega a los miembros de tu equipo de Supabase, con 2 correos por hora como máximo. |
| Supabase da error al guardar SMTP Settings o al enviar | Revisa que Username y Sender email sean tu Gmail completo, y que la contraseña sea la de aplicación, sin espacios. Si sigue fallando, crea otra contraseña de aplicación. |
| Un cambio en un móvil no aparece en el otro | Cierra la app del todo en los dos y vuelve a abrirla. Si sigue igual, comprueba que `npm run db:push` aplicó la migración de la Fase 2. |
| La app dice "Las notificaciones aún no están configuradas" | Falta `VITE_VAPID_PUBLIC_KEY` en las Variables de GitHub (paso 12). Créala y vuelve a publicar. |
| La notificación de prueba no llega | Abre la app desde el icono, no desde Safari. En los Ajustes del iPhone, comprueba **Notificaciones → Nevera** y que no haya un modo Concentración activo. Comprueba también que `npx supabase secrets list` muestra `VAPID_KEYS` y `VAPID_SUBJECT`. |
| La prueba llega, pero el aviso diario no | Mira `cron.job_run_details` (paso 12). Si dice que falta la URL, revisa los nombres `project_url` y `secret_key` del Vault. Recuerda que solo llega si hay algo caducado o a punto de caducar. En Supabase, **Edge Functions → daily-digest → Logs** cuenta qué ha enviado. |
| Al leer un ticket: "La lectura con IA todavía no está configurada" | Comprueba que `npx supabase secrets list` muestra `ANTHROPIC_API_KEY` y `ANTHROPIC_MODEL` (paso 13). Si están, el nombre del modelo está mal escrito o la clave se ha borrado en Anthropic: crea otra y repite el paso 13. En Supabase, **Edge Functions → parse-receipt → Logs** dice cuál de las dos. |
| "Se ha acabado el crédito de la lectura con IA" | Añade crédito en **Billing** de la consola de Anthropic. |
| "El servicio de lectura no responde ahora mismo" | Anthropic está saturado o ha alcanzado tu límite de gasto mensual. Prueba más tarde o revisa los límites en la consola. |
| La lectura no encuentra productos o se equivoca mucho | Haz la foto con el ticket plano, entero y con buena luz. Si es muy largo, usa **Añadir otra parte** para fotografiarlo en dos o tres trozos. Todo se puede corregir en la vista previa antes de añadir. |
| La cámara no se abre dentro de la app | Acepta el permiso de cámara cuando lo pida. Si lo rechazaste, actívalo en los Ajustes del iPhone (**Apps → Safari → Cámara**). Mientras tanto, el botón **Hacer foto** abre la cámara del sistema. |
| La app deja de responder tras días sin usarla | El plan gratuito pausa el proyecto tras una semana con poca actividad. Entra en Supabase y restáuralo: no se pierde ningún dato. |
