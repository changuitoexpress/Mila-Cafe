---
name: Screenshot verification quirks
description: How to verify the signed-in customer UI visually and avoid stale or misleading screenshots in this repl.
---
- The customer UI sits behind the phone login, so signed-in screens were verified with a throwaway harness page under a gitignored folder that seeds a fake session and stubs Supabase writes. Never add an auth bypass to app code.
- The dev server (python http.server) sends no Cache-Control, so the screenshot browser serves stale CSS/JS. Cache-bust local assets with a unique `?v=` per edit; stale assets caused false "fix didn't work" results.
- The screenshot browser keeps localStorage and the service worker for 127.0.0.1:5000 across runs. A leftover fake session makes `/` open logged in with 406 errors from `.single()` lookups. Clear the `milaCafe*` keys when done.
