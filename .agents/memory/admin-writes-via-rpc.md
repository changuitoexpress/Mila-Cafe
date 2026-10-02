---
name: Admin writes go through PIN-protected RPCs
description: How the phone-login app authorizes admin writes to Supabase and which catalog columns are dual.
---

The app has no Supabase Auth, so anon RLS blocks direct admin writes. Admin writes (products, store_settings, promotions, order stages, cancel, redeem) go through SECURITY DEFINER functions named admin_* that take p_admin_id + p_pin and return jsonb {ok, data|error}. The user runs all SQL themselves; the agent must never execute SQL and must hand over exact SQL instead.

**Why:** the user ordered "NO ejecutes SQL tú" and asked for hashed admin PIN inside every function.

**How to apply:** new admin features need a new admin_* function (hand the SQL to the user, wait for confirmation). Customer app only INSERTs/SELECTs on orders. products has both `active` and `activo`; write and filter both. Order progress lives in orders.etapa; orders.status is only pending/completed/cancelled. orders.total excludes shipping (costo_envio is separate).
