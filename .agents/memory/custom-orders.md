---
name: Pedidos personalizados
description: Reglas del negocio para complementos visibles y productos repetidos dentro de un pedido.
---

El usuario indicó: “En la app del cliente considera solo las asignaciones de product_option_groups con activo = true, y solo grupos y opciones activos.”

**Why:** ocultar un complemento, su grupo o su asignación debe dejar de ofrecerlo para pedidos nuevos, sin borrar información histórica.

**How to apply:** conservar estos tres filtros en cualquier nueva pantalla del cliente; los detalles de pedidos ya registrados se muestran desde sus datos históricos.

El usuario indicó: “Al mostrar pedidos viejos o armar el carrito, no asumas que un producto aparece una sola vez por pedido: ahora puede haber varias líneas del mismo producto.”

**Why:** las distintas opciones, instrucciones o alergias pertenecen a una línea del pedido, no al producto en general.

**How to apply:** no agrupar pedidos ni imponer unicidad únicamente por producto; preservar cada configuración y los datos con los que se pidió.
