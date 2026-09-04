---
name: Supabase CDN global naming
description: The browser CDN exposes a global named supabase, so local classic-script bindings should use another name.
---

The Supabase browser CDN exposes a global named `supabase`; declaring a top-level `const supabase` in the same page can throw `Identifier 'supabase' has already been declared` even when each script tag appears only once.

**Why:** Classic scripts share the page's global namespace, and the CDN's global can conflict with an application-level lexical declaration.

**How to apply:** Name the initialized application client `supabaseClient` (or another non-conflicting name) and use that binding for database calls.