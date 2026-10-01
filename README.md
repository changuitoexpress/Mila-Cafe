# Mila Café — Menú digital + monedero

## Qué incluye
- `index.html` / `styles.css` / `main.js` → la app que usan tus clientes (menú, carrito, monedero, confirmación de pedido)
- `dashboard.html` → consulta los pedidos y confirma pickup y delivery con «Entregado y pagado»
- El SQL original de Supabase no está incluido en este repositorio; no ejecutar instrucciones antiguas que lo mencionan como si existiera

## Paso 1 — Crear el proyecto en Supabase
1. Usa el proyecto de Supabase existente; no hay una migración SQL incluida en este repositorio.
2. Ve a **Project Settings → API** y copia dos datos:
   - **Project URL**
   - **anon public key**

## Paso 2 — Conectar la app a Supabase
1. Abre `main.js` y busca la sección `🔧 CONFIGURACIÓN` (arriba del todo).
2. Reemplaza `SUPABASE_URL` y `SUPABASE_ANON_KEY` con los datos que copiaste.
3. `dashboard.js` usa su propia conexión al mismo proyecto de Supabase.

## Paso 3 — Subir a Replit
1. Crea un Repl tipo **HTML/CSS/JS** (o "Static Site").
2. Sube los archivos de la aplicación, incluido `dashboard.html`, `dashboard.js`, el manifest, el service worker y los iconos.
3. Dale **Run**. Tu app vive en `tu-repl.replit.app` y el panel en `tu-repl.replit.app/dashboard.html`.

## Cómo funciona el flujo de dinero (para que lo tengas claro)
1. El cliente entra con su teléfono, arma su carrito y da "Confirmar pedido".
2. Se crea un pedido con estado `pending` y un token interno (no se muestra al cliente) — **todavía no se toca su saldo**.
3. El cliente ve una confirmación de pedido recibido. El administrador confirma pickup y delivery desde `dashboard.html`, que llama a `redeem_order` con el token interno.
4. Cuando `redeem_order` se ejecuta con permisos adecuados, el sistema:
   - Descuenta el saldo que el cliente pidió usar (si aplica).
   - Abona el cashback que ganó con esa compra.
   - Marca el pedido como `completed` para que no se pueda volver a usar.

## Forma de pago y envío del pedido por WhatsApp
En el carrito, el cliente elige cómo va a pagar (Efectivo, Transferencia, Pago en línea o Terminal). «Pago en línea» registra el método elegido, pero **todavía no cobra mediante una pasarela**. Al confirmar el pedido, aparece un botón verde **"Enviar pedido por WhatsApp"** que abre WhatsApp con un mensaje ya armado: nombre del cliente, cada producto con cantidad y precio, subtotal, saldo aplicado, total, forma de pago — todo lo manda directo al número del restaurante.

El número está configurado en `main.js` (y en `demo-standalone.html`) como `RESTAURANT_WHATSAPP = "522222998533"` (52 = México + tus 10 dígitos). Si cambia el número del restaurante, solo edita esa línea.

## Editar tu menú
Entra a Supabase → **Table Editor** → tabla `products`. Ahí agregas, editas o desactivas (`active = false`) tus productos sin tocar código. El campo `cashback_percent` es el % que regresa al monedero por ese producto (puedes ponerlo distinto en cada uno).

## Antes de crecer en serio, ten esto en mente
El login actual solo pide el teléfono (sin contraseña ni verificación), para que puedas arrancar rápido. Si vas a manejar dinero real de muchos clientes, el siguiente paso recomendado es activar **Supabase Auth con verificación por SMS**, para que nadie pueda entrar con el teléfono de otra persona. Con gusto te ayudo a dar ese paso cuando estés listo.
