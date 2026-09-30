# Mila Café — Menú digital + monedero con QR

## Qué incluye
- `index.html` / `styles.css` / `main.js` → la app que usan tus clientes (menú, carrito, monedero, ticket QR)
- `dashboard.html` → consulta los pedidos; los de pickup son de solo lectura
- `caja.html` → página heredada de menú, **todavía no contiene un lector ni validador de QR**
- El SQL original de Supabase no está incluido en este repositorio; no ejecutar instrucciones antiguas que lo mencionan como si existiera

## Paso 1 — Crear el proyecto en Supabase
1. Usa el proyecto de Supabase existente; no hay una migración SQL incluida en este repositorio.
2. Ve a **Project Settings → API** y copia dos datos:
   - **Project URL**
   - **anon public key**

## Paso 2 — Conectar la app a Supabase
1. Abre `main.js` y busca la sección `🔧 CONFIGURACIÓN` (arriba del todo).
2. Reemplaza `SUPABASE_URL` y `SUPABASE_ANON_KEY` con los datos que copiaste.
3. El archivo `caja.html` carga `main.js`, así que usa la misma configuración.

## Paso 3 — Subir a Replit
1. Crea un Repl tipo **HTML/CSS/JS** (o "Static Site").
2. Sube los archivos de la aplicación, incluido `dashboard.html`, `dashboard.js`, el manifest, el service worker y los iconos.
3. Dale **Run**. Tu app vive en `tu-repl.replit.app` y la de caja en `tu-repl.replit.app/caja.html`.

## Cómo funciona el flujo de dinero (para que lo tengas claro)
1. El cliente entra con su teléfono, arma su carrito y da "Generar ticket".
2. Se crea un pedido con estado `pending` y un código QR único — **todavía no se toca su saldo**.
3. El cliente recibe el QR. **La validación pickup aún no está implementada en `caja.html`**; antes de habilitarla hay que comprobar en Supabase que solo personal autorizado pueda ejecutar `redeem_order`.
4. Cuando `redeem_order` se ejecuta con permisos adecuados, el sistema:
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
