// ============================================================
// MILA CAFÉ — main.js
// ============================================================

// ============================================================
// 🔧 CONFIGURACIÓN — pon aquí tus llaves de Supabase
// Las encuentras en: Supabase → Project Settings → API
// ============================================================
const SUPABASE_URL = "https://jspmxmaeaswnumxyetcu.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_M_cDBeTCWqnii7cvT0y6bQ_C4lsVijO";

if (
  !SUPABASE_URL.trim() ||
  !SUPABASE_ANON_KEY.trim() ||
  /\s/.test(SUPABASE_URL) ||
  /\s/.test(SUPABASE_ANON_KEY)
) {
  console.error("Configuración de Supabase vacía o con caracteres inválidos.");
}

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Número de WhatsApp del restaurante (52 = México + los 10 dígitos)
const RESTAURANT_WHATSAPP = "522222998533";
const SESSION_STORAGE_KEY = "milaCafeSession";

// ============================================================
// ESTADO EN MEMORIA
// ============================================================
let currentUser = null;   // fila de "profiles"
let products = [];        // catálogo cargado desde Supabase
let cart = [];             // [{ product, qty }]
let activeProduct = null;  // producto abierto en el modal de detalle
let activeQty = 1;
let favoriteProductIds = new Set();
let categoryObserver = null;

// ============================================================
// UTILIDADES
// ============================================================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const money = (n) => Number(n || 0).toFixed(2);

function showToast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 2600);
}

function openModal(id) { $(id).classList.remove("hidden"); }
function closeModal(id) { $(id).classList.add("hidden"); }

$$("[data-close]").forEach((btn) =>
  btn.addEventListener("click", (e) => {
    e.target.closest(".modal-overlay").classList.add("hidden");
  })
);

// ============================================================
// LOGIN — identifica al cliente por teléfono
// Si el teléfono no existe en "profiles", se crea uno nuevo.
// ============================================================
$("#btn-login").addEventListener("click", handleLogin);
$("#btn-logout")?.addEventListener("click", handleLogout);
$("#menu-toggle")?.addEventListener("click", openMenu);
$("#menu-close")?.addEventListener("click", closeMenu);
$("#menu-backdrop")?.addEventListener("click", closeMenu);
$("#menu-logout")?.addEventListener("click", () => {
  closeMenu();
  handleLogout();
});
$("#menu-favorites")?.addEventListener("click", () => {
  closeMenu();
  scrollToSection("favorites-section");
});
$("#header-back")?.addEventListener("click", () => window.history.back());
$("#header-favorites")?.addEventListener("click", () => scrollToSection("favorites-section"));
$$('input[name="delivery_type"]').forEach((input) =>
  input.addEventListener("change", toggleDeliveryFields)
);

async function handleLogin() {
  let errorEl;
  try {
    const phone = $("#phone-input").value.trim();
    const name = $("#name-input").value.trim();
    errorEl = $("#login-error");
    errorEl.textContent = "";

    if (phone.length < 10) {
      errorEl.textContent = "Escribe un teléfono válido de 10 dígitos.";
      return;
    }

    // 1. Buscar si ya existe el perfil
    let { data: existing, error: findErr } = await supabaseClient
      .from("profiles")
      .select("*")
      .eq("phone", phone)
      .maybeSingle();

    if (findErr) {
      console.error("Error de Supabase DB:", findErr);
      throw findErr;
    }

    if (existing) {
      currentUser = existing;
    } else {
      // 2. Si no existe, lo creamos
      const { data: created, error: insertErr } = await supabaseClient
        .from("profiles")
        .insert({ phone, name: name || "Cliente Mila" })
        .select()
        .single();
      if (insertErr) {
        console.error("Error de Supabase DB:", insertErr);
        throw insertErr;
      }
      currentUser = created;
    }

    saveSession();
    startApp();
  } catch (err) {
    console.error("Error en el inicio de sesión:", err);
    if (errorEl) {
      errorEl.textContent = "No pudimos conectar. Revisa tu conexión o las llaves de Supabase.";
    }
  }
}

async function startApp() {
  $("#view-login").classList.remove("active");
  $("#app").classList.remove("hidden");
  $$(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === "menu"));
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === "view-menu"));
  $("#user-name-tag").textContent = currentUser.name || "Cliente Mila";
  updateAdminLinks();
  await loadFavorites();
  await loadProducts();
  refreshWalletUI();
}

function saveSession() {
  if (!currentUser) return;

  try {
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        id: currentUser.id,
        phone: currentUser.phone,
        name: currentUser.name || "Cliente Mila",
        wallet_balance: currentUser.wallet_balance || 0,
        is_admin: currentUser.is_admin === true,
      })
    );
  } catch (err) {
    console.warn("No se pudo guardar la sesión en este navegador:", err);
  }
}

function restoreSession() {
  try {
    const saved = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!saved) return;

    const session = JSON.parse(saved);
    if (!session || !session.id || !session.phone) {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      return;
    }

    currentUser = session;
    startApp();
  } catch (err) {
    console.warn("No se pudo restaurar la sesión guardada:", err);
    localStorage.removeItem(SESSION_STORAGE_KEY);
  }
}

function handleLogout() {
  localStorage.removeItem(SESSION_STORAGE_KEY);
  currentUser = null;
  products = [];
  cart = [];
  favoriteProductIds = new Set();
  closeMenu();
  updateCartBadge();
  $("#app").classList.add("hidden");
  $("#view-login").classList.add("active");
  $("#phone-input").value = "";
  $("#name-input").value = "";
  $("#login-error").textContent = "";
}

function updateAdminLinks() {
  const isAdmin = currentUser?.is_admin === true;
  ["#admin-dashboard-link", "#admin-dashboard-account"].forEach((selector) => {
    $(selector)?.classList.toggle("hidden", !isAdmin);
  });
}

function openMenu() {
  $("#side-menu")?.classList.remove("hidden");
  $("#menu-backdrop")?.classList.remove("hidden");
  $("#menu-toggle")?.setAttribute("aria-expanded", "true");
}

function closeMenu() {
  $("#side-menu")?.classList.add("hidden");
  $("#menu-backdrop")?.classList.add("hidden");
  $("#menu-toggle")?.setAttribute("aria-expanded", "false");
}

function scrollToSection(sectionId) {
  const section = document.getElementById(sectionId);
  setActiveCategoryTab(sectionId);
  section?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function toggleDeliveryFields() {
  const selected = document.querySelector('input[name="delivery_type"]:checked')?.value;
  $("#delivery-fields")?.classList.toggle("hidden", selected !== "delivery");
  if (selected !== "delivery") {
    $("#delivery-error") && ($("#delivery-error").textContent = "");
  }
}

function slugify(value, index) {
  const slug = String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `category-${slug || "otros"}-${index}`;
}

// ============================================================
// NAVEGACIÓN ENTRE TABS
// ============================================================
$$(".tab").forEach((tab) =>
  tab.addEventListener("click", () => {
    $$(".tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    $$(".view").forEach((v) => v.classList.remove("active"));
    $(`#view-${tab.dataset.tab}`).classList.add("active");
    if (tab.dataset.tab === "cuenta") {
      refreshWalletUI();
      loadTransactions();
    }
  })
);

// ============================================================
// MENÚ — carga y pinta los productos
// ============================================================
async function loadFavorites() {
  favoriteProductIds = new Set();
  if (!currentUser?.id) return;

  const { data, error } = await supabaseClient
    .from("favorites")
    .select("product_id")
    .eq("user_id", currentUser.id);

  if (error) {
    console.warn("No se pudieron cargar los favoritos:", error);
    return;
  }

  favoriteProductIds = new Set((data || []).map((favorite) => favorite.product_id));
}

function renderCategoryNavigation(categories) {
  const chips = $("#category-chips");
  const menuList = $("#category-menu-list");
  if (!chips || !menuList) return;

  chips.innerHTML = "";
  menuList.innerHTML = "";
  chips.classList.toggle("hidden", categories.length === 0);

  const exploreTab = document.createElement("button");
  exploreTab.className = "category-chip category-tab active";
  exploreTab.type = "button";
  exploreTab.dataset.section = "menu-top";
  exploreTab.textContent = "Explora el menú";
  exploreTab.addEventListener("click", () => scrollToSection("menu-top"));
  chips.appendChild(exploreTab);

  categories.forEach((category, index) => {
    const sectionId = slugify(category, index);
    const chip = document.createElement("button");
    chip.className = "category-chip category-tab";
    chip.type = "button";
    chip.dataset.section = sectionId;
    chip.textContent = category;
    chip.addEventListener("click", () => scrollToSection(sectionId));
    chips.appendChild(chip);

    const menuItem = document.createElement("button");
    menuItem.className = "side-menu-item";
    menuItem.type = "button";
    menuItem.textContent = category;
    menuItem.addEventListener("click", () => {
      closeMenu();
      scrollToSection(sectionId);
    });
    menuList.appendChild(menuItem);
  });

  const favoriteChip = document.createElement("button");
  favoriteChip.className = "category-chip category-tab category-chip-favorites";
  favoriteChip.type = "button";
  favoriteChip.dataset.section = "favorites-section";
  favoriteChip.textContent = "♡ Favoritos";
  favoriteChip.addEventListener("click", () => scrollToSection("favorites-section"));
  chips.appendChild(favoriteChip);
}

function setActiveCategoryTab(sectionId) {
  $$(".category-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.section === sectionId);
  });
}

function observeCategorySections(categories) {
  categoryObserver?.disconnect();
  if (!("IntersectionObserver" in window)) return;

  const sectionIds = [
    "menu-top",
    ...categories.map((category, index) => slugify(category, index)),
    "favorites-section",
  ];
  categoryObserver = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActiveCategoryTab(visible[0].target.id);
    },
    { rootMargin: "-132px 0px -60% 0px", threshold: [0, 0.1, 0.4] }
  );

  sectionIds
    .map((id) => document.getElementById(id))
    .filter(Boolean)
    .forEach((section) => categoryObserver.observe(section));
}

function renderProductCard(product) {
  const card = document.createElement("div");
  card.className = "product-card";
  const isFavorite = favoriteProductIds.has(product.id);
  card.innerHTML = `
    <div class="product-image-wrap">
      ${product.image_url ? `<img class="product-image" src="${product.image_url}" alt="${product.name}" loading="lazy" onerror="this.style.display='none'">` : '<div class="product-image-placeholder"></div>'}
      <button class="favorite-btn ${isFavorite ? "is-favorite" : ""}" type="button" aria-label="${isFavorite ? "Quitar de favoritos" : "Agregar a favoritos"}">${isFavorite ? "♥" : "♡"}</button>
      <button class="quick-add-btn" type="button" aria-label="Agregar ${product.name} al carrito">+</button>
    </div>
    <span class="cat">${product.category || "Café"}</span>
    <h3>${product.name}</h3>
    <p class="desc">${product.description || ""}</p>
    <div class="price-row">
      <span class="price">$${money(product.price)}</span>
      <span class="cashback-badge">Gana $${money((product.price * product.cashback_percent) / 100)} aquí</span>
    </div>
  `;
  card.addEventListener("click", () => openProductModal(product));
  card.querySelector(".favorite-btn").addEventListener("click", (event) => {
    event.stopPropagation();
    toggleFavorite(product, event.currentTarget);
  });
  card.querySelector(".quick-add-btn").addEventListener("click", (event) => {
    event.stopPropagation();
    addProductToCart(product, 1);
    showToast(`${product.name} agregado al carrito`);
  });
  return card;
}

async function toggleFavorite(product, button) {
  if (!currentUser?.id || button.disabled) return;

  const wasFavorite = favoriteProductIds.has(product.id);
  button.disabled = true;
  const response = wasFavorite
    ? await supabaseClient
        .from("favorites")
        .delete()
        .eq("user_id", currentUser.id)
        .eq("product_id", product.id)
    : await supabaseClient
        .from("favorites")
        .insert({ user_id: currentUser.id, product_id: product.id });

  button.disabled = false;
  if (response.error) {
    console.error("No se pudo actualizar el favorito:", response.error);
    showToast("No se pudo actualizar favoritos");
    return;
  }

  if (wasFavorite) favoriteProductIds.delete(product.id);
  else favoriteProductIds.add(product.id);
  button.classList.toggle("is-favorite", !wasFavorite);
  button.textContent = wasFavorite ? "♡" : "♥";
  button.setAttribute("aria-label", wasFavorite ? "Agregar a favoritos" : "Quitar de favoritos");
  renderFavoritesSection();
}

function renderFavoritesSection() {
  const previous = $("#favorites-section");
  previous?.remove();

  const section = document.createElement("section");
  section.id = "favorites-section";
  section.className = "category-group favorites-group";
  const favorites = products.filter((product) => favoriteProductIds.has(product.id));
  section.innerHTML = `
    <div class="category-heading">
      <h3>Favoritos</h3>
      <span>${favorites.length} productos</span>
    </div>
  `;

  if (favorites.length === 0) {
    section.insertAdjacentHTML(
      "beforeend",
      '<div class="menu-status menu-empty"><strong>Aún no tienes favoritos.</strong><p>Toca el corazón de un producto para guardarlo aquí.</p></div>'
    );
  } else {
    const favoritesGrid = document.createElement("div");
    favoritesGrid.className = "category-products";
    favorites.forEach((product) => favoritesGrid.appendChild(renderProductCard(product)));
    section.appendChild(favoritesGrid);
  }

  $("#products-grid")?.appendChild(section);
}

async function loadProducts() {
  const grid = $("#products-grid");
  let { data, error } = await supabaseClient
    .from("products")
    .select("*")
    .eq("active", true)
    .order("category");

  if (error || !data || data.length === 0) {
    console.error("No se pudo consultar products con active=true:", error);
    const fallback = await supabaseClient
      .from("products")
      .select("*")
      .eq("active", true)
      .order("category");
    data = fallback.data;
    error = fallback.error;
  }

  if (error) {
    grid.innerHTML = `
      <div class="menu-status menu-error">
        <strong>No se pudo cargar el menú.</strong>
        <p>La tabla products no está disponible para este acceso. Revisa la política de lectura pública en Supabase.</p>
      </div>
    `;
    console.error("Error definitivo al cargar products:", error);
    return;
  }

  products = data;
  grid.innerHTML = "";

  if (!products || products.length === 0) {
    grid.innerHTML = `
      <div class="menu-status menu-empty">
        <strong>No hay productos visibles.</strong>
        <p>Supabase respondió sin filas para products. Revisa RLS y la política SELECT de la tabla.</p>
      </div>
    `;
    console.error("products respondió cero filas; posible RLS o tabla vacía.");
    return;
  }

  const groupedProducts = new Map();
  products.forEach((product) => {
    const category = String(product.category || "Otros").trim() || "Otros";
    if (!groupedProducts.has(category)) groupedProducts.set(category, []);
    groupedProducts.get(category).push(product);
  });

  const categories = [...groupedProducts.keys()];
  renderCategoryNavigation(categories);

  groupedProducts.forEach((categoryProducts, category, map) => {
    const categoryIndex = [...map.keys()].indexOf(category);
    const group = document.createElement("section");
    group.className = "category-group";
    group.id = slugify(category, categoryIndex);

    const heading = document.createElement("div");
    heading.className = "category-heading";
    heading.innerHTML = `<h3></h3><span>${categoryProducts.length} productos</span>`;
    heading.querySelector("h3").textContent = category;

    const categoryGrid = document.createElement("div");
    categoryGrid.className = "category-products";

    categoryProducts.forEach((product) => categoryGrid.appendChild(renderProductCard(product)));

    group.appendChild(heading);
    group.appendChild(categoryGrid);
    grid.appendChild(group);
  });
  renderFavoritesSection();
  observeCategorySections(categories);
}

function openProductModal(product) {
  activeProduct = product;
  activeQty = 1;
  renderProductModal();
  openModal("#modal-product");
}

function renderProductModal() {
  const p = activeProduct;
  $("#modal-product-body").innerHTML = `
    <p class="eyebrow">${p.category || "Café"}</p>
    <h2 class="product-modal-title">${p.name}</h2>
    <p class="product-modal-price">$${money(p.price)} · <span class="cashback-badge">Gana $${money((p.price * p.cashback_percent) / 100)}</span></p>

    <div class="product-modal-section">
      <h4>Descripción</h4>
      <p>${p.description || "—"}</p>
    </div>
    <div class="product-modal-section">
      <h4>Preparación</h4>
      <p>${p.preparation || "—"}</p>
    </div>

    <div class="qty-row">
      <button class="qty-btn" id="qty-minus">−</button>
      <span class="qty-value" id="qty-value">${activeQty}</span>
      <button class="qty-btn" id="qty-plus">+</button>
    </div>

    <button class="btn btn-primary btn-block" id="btn-add-cart">Agregar al carrito</button>
  `;

  $("#qty-minus").addEventListener("click", () => {
    activeQty = Math.max(1, activeQty - 1);
    $("#qty-value").textContent = activeQty;
  });
  $("#qty-plus").addEventListener("click", () => {
    activeQty += 1;
    $("#qty-value").textContent = activeQty;
  });
  $("#btn-add-cart").addEventListener("click", addToCart);
}

function addProductToCart(product, quantity = 1) {
  const existing = cart.find((c) => c.product.id === product.id);
  if (existing) {
    existing.qty += quantity;
  } else {
    cart.push({ product, qty: quantity });
  }
  updateCartBadge();
}

function addToCart() {
  addProductToCart(activeProduct, activeQty);
  closeModal("#modal-product");
  showToast(`${activeProduct.name} agregado al carrito`);
}

function updateCartBadge() {
  const count = cart.reduce((sum, c) => sum + c.qty, 0);
  const badge = $("#cart-count");
  badge.textContent = count;
  badge.classList.toggle("hidden", count === 0);
  const floatingCart = $("#floating-cart");
  const floatingCount = $("#floating-cart-count");
  floatingCount.textContent = count;
  floatingCart.classList.toggle("hidden", count === 0);
  floatingCart.setAttribute("aria-label", `Abrir carrito (${count} productos)`);
}

// ============================================================
// CARRITO
// ============================================================
function openCart() {
  if (cart.length === 0) {
    showToast("Tu carrito está vacío");
    return;
  }
  renderCart();
  openModal("#modal-cart");
}

$("#btn-cart").addEventListener("click", openCart);
$("#floating-cart")?.addEventListener("click", openCart);

function cartSubtotal() {
  return cart.reduce((sum, c) => sum + c.product.price * c.qty, 0);
}

function renderCart() {
  const wrap = $("#cart-items");
  wrap.innerHTML = "";
  cart.forEach((c) => {
    const row = document.createElement("div");
    row.className = "cart-item-row";
    row.innerHTML = `
      <div>
        <div class="name">${c.product.name}</div>
        <div class="meta">${c.qty} × $${money(c.product.price)}</div>
      </div>
      <div>$${money(c.product.price * c.qty)}</div>
    `;
    wrap.appendChild(row);
  });

  const subtotal = cartSubtotal();
  const walletAvailable = Number(currentUser.wallet_balance || 0);

  // Mostrar opción de usar saldo solo si el cliente tiene saldo
  $("#wallet-toggle-row").classList.toggle("hidden", walletAvailable <= 0);
  $("#wallet-available-amount").textContent = `$${money(walletAvailable)}`;
  $("#use-wallet-checkbox").checked = false;
  toggleDeliveryFields();

  updateCartSummary();
}

$("#use-wallet-checkbox")?.addEventListener("change", updateCartSummary);

function updateCartSummary() {
  const subtotal = cartSubtotal();
  const useWallet = $("#use-wallet-checkbox").checked;
  const walletAvailable = Number(currentUser.wallet_balance || 0);
  const walletUsed = useWallet ? Math.min(subtotal, walletAvailable) : 0;
  const total = subtotal - walletUsed;

  $("#cart-subtotal").textContent = `$${money(subtotal)}`;
  $("#cart-total").textContent = `$${money(total)}`;
  $("#cart-wallet-row").style.display = walletUsed > 0 ? "flex" : "none";
  $("#cart-wallet-used").textContent = `-$${money(walletUsed)}`;
}

// ============================================================
// CHECKOUT — crea la orden + sus items y genera la confirmación del pedido
// El cashback se calcula solo (trigger en Supabase).
// El saldo NO se descuenta aquí: se descuenta hasta que el
// administrador confirme el pedido en el dashboard (función redeem_order).
// ============================================================
$("#btn-checkout").addEventListener("click", handleCheckout);

async function handleCheckout() {
  const subtotal = cartSubtotal();
  const useWallet = $("#use-wallet-checkbox").checked;
  const walletAvailable = Number(currentUser.wallet_balance || 0);
  const walletUsed = useWallet ? Math.min(subtotal, walletAvailable) : 0;
  const paymentMethod = document.querySelector('input[name="payment"]:checked').value;
  const deliveryType = document.querySelector('input[name="delivery_type"]:checked')?.value || "pickup";
  const delivery = {
    fraccionamiento: $("#delivery-fraccionamiento")?.value.trim() || "",
    calle: $("#delivery-calle")?.value.trim() || "",
    numero: $("#delivery-numero")?.value.trim() || "",
    referencias: $("#delivery-referencias")?.value.trim() || "",
  };

  // Guardamos una copia de los items del carrito ANTES de vaciarlo,
  // porque los necesitamos para armar el mensaje de WhatsApp.
  const cartSnapshot = cart.map((c) => ({ name: c.product.name, qty: c.qty, price: c.product.price }));

  if (deliveryType === "delivery" && Object.values(delivery).some((value) => !value)) {
    $("#delivery-error").textContent = "Completa todos los datos de entrega.";
    $("#delivery-fields")?.classList.remove("hidden");
    return;
  }
  $("#delivery-error") && ($("#delivery-error").textContent = "");

  try {
    // 1. Crear la orden (pending)
    const { data: order, error: orderErr } = await supabaseClient
      .from("orders")
      .insert({
        user_id: currentUser.id,
        wallet_used: walletUsed,
        payment_method: paymentMethod,
        delivery_type: deliveryType,
        fraccionamiento: deliveryType === "delivery" ? delivery.fraccionamiento : null,
        calle: deliveryType === "delivery" ? delivery.calle : null,
        numero: deliveryType === "delivery" ? delivery.numero : null,
        referencias: deliveryType === "delivery" ? delivery.referencias : null,
      })
      .select()
      .single();
    if (orderErr) throw orderErr;

    // 2. Insertar los productos del carrito (esto dispara el trigger
    //    que calcula total y cashback_earned en la tabla orders)
    const itemsPayload = cart.map((c) => ({
      order_id: order.id,
      product_id: c.product.id,
      quantity: c.qty,
      unit_price: c.product.price,
      cashback_percent: c.product.cashback_percent,
    }));
    const { error: itemsErr } = await supabaseClient.from("order_items").insert(itemsPayload);
    if (itemsErr) throw itemsErr;

    // 3. Releer la orden ya con total/cashback calculados por el trigger
    const { data: finalOrder, error: reErr } = await supabaseClient
      .from("orders")
      .select("*")
      .eq("id", order.id)
      .single();
    if (reErr) throw reErr;

    finalOrder.items = cartSnapshot;
    finalOrder.subtotal = subtotal;
    showOrderConfirmation(finalOrder);
    cart = [];
    updateCartBadge();
    closeModal("#modal-cart");
  } catch (err) {
    console.error(err);
    showToast("No se pudo registrar el pedido. Intenta de nuevo.");
  }
}

function buildWhatsappMessage(order) {
  const lines = [];
  lines.push(`🛍️ *Nuevo pedido — Mila Café*`);
  lines.push(`Cliente: ${currentUser.name || "Cliente"} (${currentUser.phone})`);
  lines.push(`—————————————`);
  order.items.forEach((it) => {
    lines.push(`${it.qty}x ${it.name} — $${money(it.price * it.qty)}`);
  });
  lines.push(`—————————————`);
  lines.push(`Subtotal: $${money(order.subtotal)}`);
  if (order.wallet_used > 0) lines.push(`Saldo de monedero aplicado: -$${money(order.wallet_used)}`);
  lines.push(`*Total a pagar: $${money(order.total)}*`);
  lines.push(`Forma de pago: ${order.payment_method}`);
  if (order.delivery_type === "delivery") {
    lines.push(`Entrega a domicilio: ${order.fraccionamiento}, calle ${order.calle}, número ${order.numero}`);
    lines.push(`Referencias: ${order.referencias}`);
  } else {
    lines.push("Entrega: Pasar a recoger");
  }
  lines.push(`Cashback que ganará: $${money(order.cashback_earned)}`);
  return lines.join("\n");
}

function showOrderConfirmation(order) {
  $("#ticket-message").textContent = order.delivery_type === "delivery"
    ? "Tu pedido fue recibido, un repartidor te lo llevará pronto."
    : "Tu pedido fue recibido, pásalo a recoger en unos minutos.";
  $("#ticket-detail").innerHTML = `
    <div class="row"><span>Total a pagar</span><span>$${money(order.total)}</span></div>
    <div class="row"><span>Saldo aplicado</span><span>-$${money(order.wallet_used)}</span></div>
    <div class="row"><span>Forma de pago</span><span>${order.payment_method}</span></div>
    <div class="row"><span>Entrega</span><span>${order.delivery_type === "delivery" ? "A domicilio" : "Pasar a recoger"}</span></div>
    <div class="row"><span>Cashback que ganarás</span><span>+$${money(order.cashback_earned)}</span></div>
  `;

  const waText = encodeURIComponent(buildWhatsappMessage(order));
  $("#btn-whatsapp").href = `https://wa.me/${RESTAURANT_WHATSAPP}?text=${waText}`;

  openModal("#modal-ticket");
}

// ============================================================
// MI CUENTA — saldo e historial
// ============================================================
async function refreshWalletUI() {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("wallet_balance, is_admin, name, phone")
    .eq("id", currentUser.id)
    .single();
  if (!error && data) {
    currentUser.wallet_balance = data.wallet_balance;
    currentUser.is_admin = data.is_admin === true;
    currentUser.name = data.name || currentUser.name;
    currentUser.phone = data.phone || currentUser.phone;
    $("#wallet-balance").textContent = money(data.wallet_balance);
    saveSession();
    updateAdminLinks();
  }
}

async function loadTransactions() {
  const list = $("#transactions-list");
  const { data, error } = await supabaseClient
    .from("transactions")
    .select("*")
    .eq("user_id", currentUser.id)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error || !data || data.length === 0) {
    list.innerHTML = `<p class="loading-text">Aún no tienes movimientos.</p>`;
    return;
  }

  const labels = {
    cashback: "Cashback ganado",
    redeem_debit: "Pago con saldo",
    manual_adjust: "Ajuste",
  };

  list.innerHTML = "";
  data.forEach((tx) => {
    const row = document.createElement("div");
    row.className = "tx-row";
    const positive = Number(tx.amount) >= 0;
    row.innerHTML = `
      <div>
        <div class="tx-type">${labels[tx.type] || tx.type}</div>
        <div class="tx-date">${new Date(tx.created_at).toLocaleString("es-MX")}</div>
      </div>
      <div class="${positive ? "tx-amount-positive" : "tx-amount-negative"}">
        ${positive ? "+" : ""}$${money(tx.amount)}
      </div>
    `;
    list.appendChild(row);
  });
}

restoreSession();
