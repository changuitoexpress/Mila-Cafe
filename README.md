# Mila Café — Menú digital + monedero con QR

## Qué incluye
- `index.html` / `styles.css` / `main.js` → la app que usan tus clientes (menú, carrito, monedero, ticket QR)
- `caja.html` → el panel que usa tu personal para validar el ticket cuando el cliente lo muestra
- `schema.sql` → todo lo que necesitas correr en Supabase (tablas + reglas de cashback + validación de QR)

## Paso 1 — Crear el proyecto en Supabase
1. Entra a supabase.com → crea un proyecto nuevo (gratis).
2. Ve a **SQL Editor** → pega TODO el contenido de `schema.sql` → dale **Run**.
   Esto crea las tablas, calcula el cashback automáticamente y deja 4 productos de ejemplo.
3. Ve a **Project Settings → API** y copia dos datos:
   - **Project URL**
   - **anon public key**

## Paso 2 — Conectar la app a Supabase
1. Abre `main.js` y busca la sección `🔧 CONFIGURACIÓN` (arriba del todo).
2. Reemplaza `SUPABASE_URL` y `SUPABASE_ANON_KEY` con los datos que copiaste.
3. Haz lo mismo dentro de `caja.html` (busca las mismas dos líneas).

## Paso 3 — Subir a Replit
1. Crea un Repl tipo **HTML/CSS/JS** (o "Static Site").
2. Sube los 5 archivos (`index.html`, `styles.css`, `main.js`, `caja.html`, y guarda `schema.sql` como referencia).
3. Dale **Run**. Tu app vive en `tu-repl.replit.app` y la de caja en `tu-repl.replit.app/caja.html`.

## Cómo funciona el flujo de dinero (para que lo tengas claro)
1. El cliente entra con su teléfono, arma su carrito y da "Generar ticket".
2. Se crea un pedido con estado `pending` y un código QR único — **todavía no se toca su saldo**.
3. El cliente muestra el QR en caja. Tu personal lo escanea (o pega el código) en `caja.html`.
4. En ese momento, y solo en ese momento, el sistema:
   - Descuenta el saldo que el cliente pidió usar (si aplica).
   - Abona el cashback que ganó con esa compra.
   - Marca el ticket como `completed` para que no se pueda volver a usar.

## Forma de pago y envío del pedido por WhatsApp
En el carrito, el cliente elige cómo va a pagar (Efectivo, Transferencia, Retiro sin tarjeta o Terminal). Al generar el ticket, aparece un botón verde **"Enviar pedido por WhatsApp"** que abre WhatsApp con un mensaje ya armado: nombre del cliente, cada producto con cantidad y precio, subtotal, saldo aplicado, total, forma de pago y el código del ticket — todo lo manda directo al número del restaurante.

El número está configurado en `main.js` (y en `demo-standalone.html`) como `RESTAURANT_WHATSAPP = "522222998533"` (52 = México + tus 10 dígitos). Si cambia el número del restaurante, solo edita esa línea.

## Editar tu menú
Entra a Supabase → **Table Editor** → tabla `products`. Ahí agregas, editas o desactivas (`active = false`) tus productos sin tocar código. El campo `cashback_percent` es el % que regresa al monedero por ese producto (puedes ponerlo distinto en cada uno).

## Antes de crecer en serio, ten esto en mente
El login actual solo pide el teléfono (sin contraseña ni verificación), para que puedas arrancar rápido. Si vas a manejar dinero real de muchos clientes, el siguiente paso recomendado es activar **Supabase Auth con verificación por SMS**, para que nadie pueda entrar con el teléfono de otra persona. Con gusto te ayudo a dar ese paso cuando estés listo.
