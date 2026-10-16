// Mila Café — motion layer for the customer menu.
// Native Web Animations API + CSS only (no libraries, nothing extra to download).
// main.js and the product sheet call these hooks with optional chaining, so the menu,
// cart, wallet and checkout behave exactly the same if this file is missing or motion is off.
window.MilaMotion = (() => {
  const root = document.documentElement;
  const reducedQuery = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  const reduced = () => reducedQuery?.matches === true;
  const canAnimate = (element) => Boolean(element) && typeof element.animate === "function" && !reduced();
  // jsdom and very old browsers have no requestAnimationFrame: apply the change right away.
  const nextFrame = (callback) => (typeof window.requestAnimationFrame === "function" ? window.requestAnimationFrame(callback) : callback());
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const quote = (value) => (window.CSS?.escape ? window.CSS.escape(String(value)) : String(value).replace(/["\\]/g, "\\$&"));
  const rendered = (element) => Boolean(element) && element.getClientRects().length > 0;
  const SETTLE = "cubic-bezier(.22, 1, .36, 1)";
  const SPRING = window.CSS?.supports?.("animation-timing-function", "linear(0, 1)")
    ? "linear(0, 0.081, 0.266, 0.485, 0.69, 0.857, 0.977, 1.051, 1.086, 1.095, 1.085, 1.067, 1.046, 1.027, 1.012, 1.001, 0.995, 0.992, 0.991, 0.992, 0.994, 0.996, 0.998, 0.999, 1)"
    : "cubic-bezier(.34, 1.45, .64, 1)";

  root.classList.add("has-motion");

  // ---------- 3D tilt: follows the cursor on desktop and the finger while pressed on touch ----------
  // A touch only tilts after a short hold, so starting a scroll on top of a card never flickers it.
  const PRESS_DELAY = 70;
  let tilt = null;
  let press = null;

  const cardAt = (event) => {
    if (reduced() || !(event.target instanceof Element)) return null;
    return event.target.closest("#products-grid .product-card");
  };

  function engageTilt(card, point, pressed) {
    const wrap = card.querySelector(".product-image-wrap");
    if (!wrap) return;
    tilt = { card, rect: wrap.getBoundingClientRect(), pointerId: point.pointerId, mouse: point.pointerType === "mouse", x: 0, y: 0, queued: false };
    card.classList.add("is-tilting");
    card.classList.toggle("is-pressed", pressed);
    trackTilt(point);
  }

  function trackTilt(point) {
    const current = tilt;
    if (!current.rect.width || !current.rect.height) return;
    current.x = clamp((point.clientX - current.rect.left) / current.rect.width - 0.5, -0.5, 0.5);
    current.y = clamp((point.clientY - current.rect.top) / current.rect.height - 0.5, -0.5, 0.5);
    if (current.queued) return;
    current.queued = true;
    nextFrame(() => {
      current.queued = false;
      if (tilt !== current) return;
      current.card.style.setProperty("--tilt-x", current.x.toFixed(3));
      current.card.style.setProperty("--tilt-y", current.y.toFixed(3));
    });
  }

  function cancelPress() {
    if (!press) return;
    clearTimeout(press.timer);
    press = null;
  }

  function releaseTilt() {
    cancelPress();
    if (!tilt) return;
    const { card } = tilt;
    tilt = null;
    card.classList.remove("is-tilting", "is-pressed");
    card.style.setProperty("--tilt-x", "0");
    card.style.setProperty("--tilt-y", "0");
  }

  const pointOf = (event) => ({ clientX: event.clientX, clientY: event.clientY, pointerId: event.pointerId, pointerType: event.pointerType });

  function onPointerMove(event) {
    if (event.pointerType === "mouse") {
      const card = cardAt(event);
      if (tilt && tilt.card === card) { trackTilt(event); return; }
      releaseTilt();
      if (card) engageTilt(card, pointOf(event), false);
      return;
    }
    if (press && press.pointerId === event.pointerId) {
      press.point = pointOf(event);
      if (Math.hypot(event.clientX - press.startX, event.clientY - press.startY) > 10) cancelPress();
    }
    if (tilt && tilt.pointerId === event.pointerId) trackTilt(event);
  }

  function onPointerDown(event) {
    if (event.pointerType === "mouse" || event.isPrimary === false) return;
    releaseTilt();
    const card = cardAt(event);
    // The heart and + buttons have their own press feedback.
    if (!card || event.target.closest("button")) return;
    const pending = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, point: pointOf(event) };
    pending.timer = setTimeout(() => {
      if (press !== pending) return;
      press = null;
      if (card.isConnected) engageTilt(card, pending.point, true);
    }, PRESS_DELAY);
    press = pending;
  }

  function onPointerEnd(event) {
    if (press && press.pointerId === event.pointerId) cancelPress();
    if (tilt && !tilt.mouse && tilt.pointerId === event.pointerId) releaseTilt();
  }

  // ---------- Menu cards rise in once, the first time each one comes into view ----------
  const revealed = new Set();
  let revealObserver = null;
  const revealKey = (card) => `${card.closest("section")?.id || ""}:${card.dataset.productId || ""}`;

  function rise(card, delay) {
    card.animate(
      [{ opacity: 0, translate: "0 18px" }, { opacity: 1, translate: "0 0" }],
      { duration: 560, delay, easing: SETTLE, fill: "backwards" }
    );
  }

  function menuRendered(grid) {
    placeIndicator(false);
    revealObserver?.disconnect();
    revealObserver = null;
    if (!grid) return;
    const fresh = [...grid.querySelectorAll(".product-card")].filter((card) => !revealed.has(revealKey(card)));
    fresh.forEach((card) => revealed.add(revealKey(card)));
    if (!fresh.length || !canAnimate(grid)) return;
    const fold = window.innerHeight || root.clientHeight;
    const below = [];
    let order = 0;
    fresh.forEach((card) => {
      const box = card.getBoundingClientRect();
      if (box.bottom > 0 && box.top < fold) rise(card, Math.min(order++, 7) * 60);
      else if (box.top >= fold) below.push(card);
    });
    if (!below.length || typeof window.IntersectionObserver !== "function") return;
    revealObserver = new IntersectionObserver((entries, observer) => {
      let batch = 0;
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        observer.unobserve(entry.target);
        rise(entry.target, Math.min(batch++, 3) * 70);
      });
    }, { rootMargin: "0px 0px 20% 0px" });
    below.forEach((card) => revealObserver.observe(card));
  }

  // ---------- Category bar: an indicator glides to the active chip and keeps it in view ----------
  let indicator = null;
  let heldSection = null;
  let holdTimer = 0;

  function placeIndicator(animate) {
    const bar = document.getElementById("category-chips");
    if (!bar) return;
    if (!indicator || indicator.parentElement !== bar) {
      indicator = document.createElement("span");
      indicator.className = "chip-indicator";
      indicator.setAttribute("aria-hidden", "true");
      bar.prepend(indicator);
      animate = false;
    }
    const active = bar.querySelector(".category-chip.active");
    if (!active || !active.offsetWidth) { indicator.style.opacity = "0"; return; }
    const smooth = animate && !reduced();
    indicator.classList.toggle("is-instant", !smooth);
    indicator.style.opacity = "1";
    indicator.style.width = `${active.offsetWidth}px`;
    indicator.style.transform = `translateX(${active.offsetLeft}px)`;
    const room = bar.scrollWidth - bar.clientWidth;
    if (room <= 1) return;
    const target = clamp(active.offsetLeft - (bar.clientWidth - active.offsetWidth) / 2, 0, room);
    if (Math.abs(bar.scrollLeft - target) < 2) return;
    if (typeof bar.scrollTo === "function") bar.scrollTo({ left: target, behavior: smooth ? "smooth" : "auto" });
    else bar.scrollLeft = target;
  }

  function releaseHold() {
    heldSection = null;
    window.removeEventListener("scroll", extendHold);
  }

  function extendHold() {
    clearTimeout(holdTimer);
    holdTimer = setTimeout(releaseHold, 160);
  }

  // While the page glides to a tapped category, the sections in between must not steal the highlight.
  function holdCategory(sectionId) {
    heldSection = sectionId;
    window.removeEventListener("scroll", extendHold);
    window.addEventListener("scroll", extendHold, { passive: true });
    clearTimeout(holdTimer);
    holdTimer = setTimeout(releaseHold, 1000);
  }

  // ---------- Tabs: each view enters from its side and keeps its own scroll position ----------
  const viewScroll = new Map();
  function viewChanged(previous, next) {
    if (!next || previous === next) return;
    if (previous) viewScroll.set(previous, window.scrollY || 0);
    const app = document.getElementById("app");
    if (app) app.dataset.viewDirection = next === "menu" ? "back" : "forward";
    const top = viewScroll.get(next) || 0;
    if (Math.abs((window.scrollY || 0) - top) > 1) window.scrollTo(0, top);
    if (next === "menu") nextFrame(() => placeIndicator(false));
    if (next === "cuenta") nextFrame(flushWallet);
  }

  // ---------- Add to cart: the product arcs into the cart, which answers with a bump ----------
  function cartTarget() {
    const floating = document.getElementById("floating-cart");
    if (floating && !floating.classList.contains("hidden") && rendered(floating)) {
      // offset* ignore transforms, so the point is right even while the button is still entering.
      const icon = floating.querySelector(".floating-cart-icon");
      const x = floating.offsetLeft + floating.clientLeft + (icon ? icon.offsetLeft + icon.offsetWidth / 2 : floating.offsetWidth / 2);
      const y = floating.offsetTop + floating.clientTop + (icon ? icon.offsetTop + icon.offsetHeight / 2 : floating.offsetHeight / 2);
      return { element: floating, point: { x, y } };
    }
    const header = document.getElementById("btn-cart");
    if (!rendered(header)) return null;
    const box = header.getBoundingClientRect();
    return { element: header, point: { x: box.left + box.width / 2, y: box.top + box.height / 2 } };
  }

  function bump(element) {
    if (canAnimate(element)) {
      element.animate([{ scale: 1 }, { scale: 1.1, offset: 0.35 }, { scale: 1 }], { duration: 460, easing: "cubic-bezier(.3, .7, .4, 1)" });
    }
    ["cart-count", "floating-cart-count"].forEach((id) => {
      const badge = document.getElementById(id);
      if (canAnimate(badge) && rendered(badge)) badge.animate([{ scale: 0.4 }, { scale: 1 }], { duration: 520, easing: SPRING });
    });
  }

  function cartAdded(product) {
    const target = cartTarget();
    if (!target) return;
    const source = document.getElementById("sheet-add");
    if (!canAnimate(document.body) || !rendered(source)) { bump(target.element); return; }
    const box = source.getBoundingClientRect();
    const from = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    const flyer = document.createElement("div");
    flyer.className = "cart-flyer";
    flyer.setAttribute("aria-hidden", "true");
    flyer.style.left = `${from.x}px`;
    flyer.style.top = `${from.y}px`;
    const dot = document.createElement("div");
    dot.className = "cart-flyer-dot";
    const photo = window.MilaMedia?.urls?.(product)?.[0];
    if (photo) {
      const image = document.createElement("img");
      image.alt = "";
      image.src = photo;
      dot.appendChild(image);
    }
    flyer.appendChild(dot);
    document.body.appendChild(flyer);
    const dx = target.point.x - from.x;
    const dy = target.point.y - from.y;
    const lift = clamp(Math.abs(dx) * 0.3 + 48, 56, 120);
    const duration = 760;
    // Horizontal and vertical motion use different curves, which draws a natural arc.
    flyer.animate([{ translate: "0 0" }, { translate: `${dx}px 0` }], { duration, easing: "cubic-bezier(.45, 0, .55, 1)", fill: "both" });
    const flight = dot.animate([
      { translate: "0 0", scale: 0.55, opacity: 0, easing: "cubic-bezier(.2, .7, .3, 1)" },
      { translate: `0 ${-lift}px`, scale: 1, opacity: 1, offset: 0.32, easing: "cubic-bezier(.55, 0, .85, .45)" },
      { translate: `0 ${dy}px`, scale: 0.32, opacity: 0.85 },
    ], { duration, fill: "both" });
    flight.onfinish = () => { flyer.remove(); bump(target.element); };
    flight.oncancel = () => flyer.remove();
  }

  // ---------- Favorites: keep the tapped card in place and give the heart a small pop ----------
  function popHeart(button, favorited) {
    const icon = button?.querySelector("svg");
    if (!canAnimate(icon)) return;
    icon.animate(
      favorited
        ? [{ scale: 1 }, { scale: 1.32, offset: 0.35 }, { scale: 0.94, offset: 0.7 }, { scale: 1 }]
        : [{ scale: 1 }, { scale: 0.84, offset: 0.4 }, { scale: 1 }],
      { duration: favorited ? 520 : 320, easing: "ease-out" }
    );
    if (!favorited) return;
    button.classList.remove("is-popping");
    button.addEventListener("animationend", () => button.classList.remove("is-popping"), { once: true });
    nextFrame(() => button.classList.add("is-popping"));
  }

  function capturePlace(button) {
    const card = button?.closest?.(".product-card");
    const section = card?.closest("section");
    if (!card || !section?.id || !card.dataset.productId) return null;
    const before = card.getBoundingClientRect().top;
    const selector = `#${quote(section.id)} .product-card[data-product-id="${quote(card.dataset.productId)}"]`;
    return {
      restore(favorited) {
        const next = document.querySelector(selector);
        if (!next) return;
        const shift = next.getBoundingClientRect().top - before;
        if (Math.abs(shift) > 0.5) window.scrollBy(0, shift);
        popHeart(next.querySelector(".favorite-btn"), favorited);
      },
    };
  }

  // ---------- Wallet: the balance counts to its new value and shows the difference ----------
  let walletPending = null;
  let walletRun = 0;

  function showWalletDelta(card, delta) {
    let chip = card.querySelector(".wallet-delta");
    if (!chip) {
      chip = document.createElement("span");
      chip.className = "wallet-delta";
      chip.setAttribute("aria-hidden", "true");
      card.appendChild(chip);
    }
    chip.textContent = `${delta > 0 ? "+" : "−"}$${Math.abs(delta).toFixed(2)}`;
    chip.classList.toggle("is-negative", delta < 0);
    if (typeof chip.animate !== "function") return;
    chip.getAnimations?.().forEach((animation) => animation.cancel());
    chip.animate(reduced()
      ? [{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }]
      : [
        { opacity: 0, translate: "0 10px", scale: 0.9 },
        { opacity: 1, translate: "0 0", scale: 1, offset: 0.14 },
        { opacity: 1, translate: "0 0", scale: 1, offset: 0.82 },
        { opacity: 0, translate: "0 -8px", scale: 1 },
      ], { duration: 2600, easing: "ease-out", fill: "both" });
  }

  function sheen(card) {
    if (!canAnimate(card)) return;
    let light = card.querySelector(".wallet-sheen");
    if (!light) {
      light = document.createElement("span");
      light.className = "wallet-sheen";
      light.setAttribute("aria-hidden", "true");
      card.appendChild(light);
    }
    light.animate([{ translate: "-120% 0", opacity: 0 }, { opacity: 1, offset: 0.25 }, { translate: "120% 0", opacity: 0 }], { duration: 1200, easing: "cubic-bezier(.4, 0, .2, 1)" });
  }

  function playWallet(element, from, to) {
    const run = ++walletRun;
    const card = element.closest(".wallet-card");
    if (card) { showWalletDelta(card, to - from); sheen(card); }
    if (reduced() || typeof window.requestAnimationFrame !== "function") { element.textContent = to.toFixed(2); return; }
    const duration = clamp(600 + Math.abs(to - from) * 4, 700, 1300);
    let start = null;
    element.textContent = from.toFixed(2);
    const step = (now) => {
      if (run !== walletRun) return;
      if (start === null) start = now;
      const progress = clamp((now - start) / duration, 0, 1);
      const eased = 1 - Math.pow(1 - progress, 4);
      element.textContent = progress < 1 ? (from + (to - from) * eased).toFixed(2) : to.toFixed(2);
      if (progress < 1) window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
  }

  function flushWallet() {
    if (!walletPending) return;
    const { element, from, to } = walletPending;
    walletPending = null;
    if (Math.abs(to - from) >= 0.005) playWallet(element, from, to);
  }

  function walletChanged(element, from, to) {
    if (!element || !Number.isFinite(from) || !Number.isFinite(to)) return;
    const view = element.closest(".view");
    // A change that happens while "Mi cuenta" is closed plays when the customer opens it.
    // Opening the tab refreshes the balance again; that refresh must not swallow the waiting change.
    const start = walletPending ? walletPending.from : from;
    if (view && !view.classList.contains("active")) {
      walletPending = { element, from: start, to };
      return;
    }
    walletPending = null;
    if (Math.abs(to - start) < 0.005) return;
    playWallet(element, start, to);
  }

  function pulse(element) {
    if (!canAnimate(element)) return;
    element.animate([{ scale: 1 }, { scale: 1.3, offset: 0.4 }, { scale: 1 }], { duration: 300, easing: "ease-out" });
  }

  document.addEventListener("pointermove", onPointerMove, { passive: true });
  document.addEventListener("pointerdown", onPointerDown, { passive: true });
  document.addEventListener("pointerup", onPointerEnd, { passive: true });
  document.addEventListener("pointercancel", onPointerEnd, { passive: true });
  document.addEventListener("pointerout", (event) => { if (tilt?.mouse && !event.relatedTarget) releaseTilt(); }, { passive: true });
  window.addEventListener("scroll", () => { if (tilt || press) releaseTilt(); }, { passive: true });
  window.addEventListener("resize", () => placeIndicator(false), { passive: true });
  reducedQuery?.addEventListener?.("change", releaseTilt);
  // Chip widths change when the web fonts arrive.
  document.fonts?.ready?.then(() => placeIndicator(false));

  return {
    menuRendered,
    categoryChanged: () => placeIndicator(true),
    holdCategory,
    categoryLocked: () => heldSection !== null,
    scrollBehavior: () => (reduced() ? "auto" : "smooth"),
    viewChanged,
    cartAdded,
    walletChanged,
    pulse,
    capturePlace,
  };
})();
