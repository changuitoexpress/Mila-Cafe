---
name: Menu motion and visual rules
description: Constraints for animations, tilt and visual polish in the customer menu (libraries, gating, performance, wallet animation pitfall). Colors live in brand-theme.md.
---
- No animation libraries. Framer Motion needs React; this app is plain JS with no build step, so motion is CSS + Web Animations API.
  **Why:** no new downloads or load regression. **How to apply:** reuse the motion variables/keyframes in the motion stylesheet instead of adding a library.
- Every motion rule is gated by `html.has-motion` (set by the motion script) and `prefers-reduced-motion: no-preference`; app code calls motion hooks with optional chaining so cart, checkout and wallet never depend on motion loading.
- Idle product cards must not carry a 3D transform; the tilt exists only while the card is touched/hovered. Otherwise ~68 cards become GPU layers on phones.
- Dialog exits use `transition-behavior: allow-discrete` on `display`; this works even though `.hidden` is `display:none !important` (transitions outrank important declarations).
- Wallet pitfall: opening "Mi cuenta" refreshes the balance again with the same value. A balance change that arrived while the tab was closed must merge with that refresh (animate from the pending "from"), or the animation is silently swallowed.
