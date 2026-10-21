---
name: Brand identity and themes
description: Rules for colors, light/night themes, logos and PWA icons of Mila Café after the identity change.
---
- Every color lives in theme.css as a variable (themes `mila` light default and `noche`, set via data-theme on html, stored in localStorage `mila-tema`). No hex/rgba/hsl in any other CSS, HTML or JS; a test enforces it.
  **Why:** the owner asked for one central palette (green #274034, cream #F3EFE4, Pantone 324 U gray #B5B1A7) and a night mode. **How to apply:** add or adjust a token in theme.css, never a literal color elsewhere.
- Always starts in `mila`; the system dark mode is ignored on purpose. The night theme value is "noche", not "night".
- Never put --text-2, --danger, --success or --warning on --chip backgrounds in the light theme (they fall below 4.5:1). Text on chips uses --text; a danger action on a chip button gets a raised background instead.
- Header is dark in both themes with logo-crema; logo-verde is only for light surfaces (login card). Photos are never inverted in night.
- The manifest file is manifest.webmanifest (the owner calls it manifest.json). Service worker cache name must be bumped whenever static files are added or removed, and every listed file must exist or install fails.
