---
name: Supabase public schema inspection
description: Read-only schema inspection when the Supabase publishable key cannot access OpenAPI.
---

The Supabase publishable key used by this project can SELECT public tables, but cannot read the REST root OpenAPI endpoint: it returns "Secret API key required".

**Why:** assuming OpenAPI is available with the public key led to repeated failed schema-discovery attempts. Empty tables also return no useful CSV column header.

**How to apply:** do not obtain a secret key just to inspect schema. Use known public SELECT responses or narrow, read-only projected-column requests with limit=0 to verify column existence on empty tables. If types or constraints remain uncertain, use checks inside SQL provided to the user, never execute their SQL yourself.
