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
const ADDRESS_STORAGE_KEY = "milaCafeAddress";
const CASHBACK_PERCENT = 5;
const ADDRESS_FIELDS = ["fraccionamiento", "calle", "numero"];
let addressLookup = null;
let addressLookupUserId = null;
let cartAddressInitialized = false;
let cartAddressEdited = false;
let profileAddressEdited = false;

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
let menuSearch = "";

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
$("#header-search").addEventListener("click", () => {
  $("#menu-search-bar").classList.remove("hidden");
  $("#header-search").setAttribute("aria-expanded", "true");
  $("#menu-search-input").focus();
});
$("#menu-search-input").addEventListener("input", (event) => {
  menuSearch = event.target.value;
  renderMenu();
});
$("#menu-search-input").addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMenuSearch();
});
$("#menu-search-close").addEventListener("click", closeMenuSearch);
$(".menu-filter").addEventListener("click", () => scrollToSection("featured-section"));
$$('input[name="delivery_type"]').forEach((input) =>
  input.addEventListener("change", toggleDeliveryFields)
);
$$('input[name="payment"]').forEach((input) =>
  input.addEventListener("change", () => { $("#payment-error").textContent = ""; })
);
ADDRESS_FIELDS.forEach((field) => {
  $(`#delivery-${field}`).addEventListener("input", () => { cartAddressEdited = true; });
  $(`#address-${field}`).addEventListener("input", () => { profileAddressEdited = true; });
});
$("#saved-address-form").addEventListener("submit", saveProfileAddress);

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
  localStorage.removeItem(ADDRESS_STORAGE_KEY);
  addressLookup = null;
  addressLookupUserId = null;
  cartAddressInitialized = false;
  cartAddressEdited = false;
  profileAddressEdited = false;
  ADDRESS_FIELDS.forEach((field) => {
    $(`#delivery-${field}`).value = "";
    $(`#address-${field}`).value = "";
  });
  $("#address-feedback").textContent = "";
  $("#payment-error").textContent = "";
  currentUser = null;
  updateAdminLinks();
  menuSearch = "";
  $("#menu-search-input").value = "";
  $("#menu-search-bar").classList.add("hidden");
  $("#header-search").setAttribute("aria-expanded", "false");
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

async function updateAdminLinks() {
  const links = ["#admin-dashboard-link", "#admin-dashboard-account"];
  links.forEach((selector) => $(selector)?.classList.add("hidden"));
  const userId = currentUser?.id;
  if (!userId) return;
  // Comprobar el perfil real: no confiar en is_admin guardado en el dispositivo.
  const { data, error } = await supabaseClient.from("profiles")
    .select("is_admin").eq("id", userId).single();
  if (currentUser?.id !== userId) return;
  if (!error && data?.is_admin === true) {
    links.forEach((selector) => $(selector)?.classList.remove("hidden"));
  }
}

function closeMenuSearch() {
  menuSearch = "";
  $("#menu-search-input").value = "";
  $("#menu-search-bar").classList.add("hidden");
  $("#header-search").setAttribute("aria-expanded", "false");
  renderMenu();
  $("#header-search").focus();
}

function normalizeMenuText(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function getMenuSections() {
  const term = normalizeMenuText(menuSearch).trim();
  const visible = products.filter((product) => product.active === true && product.activo === true &&
    (!term || normalizeMenuText(`${product.name || ""} ${product.description || ""}`).includes(term)))
    .sort((a, b) => Number(a.orden || 0) - Number(b.orden || 0) ||
      String(a.name || "").localeCompare(String(b.name || ""), "es"));
  const sections = [];
  const featured = visible.filter((product) => product.destacado === true);
  if (featured.length) sections.push({ id: "featured-section", title: "Destacados", products: featured });
  const favorites = currentUser?.id ? visible.filter((product) => favoriteProductIds.has(product.id)) : [];
  if (favorites.length) sections.push({ id: "favorites-section", title: "Tus favoritos", products: favorites });
  const categories = [...new Set(visible.map((product) => String(product.category || "Otros").trim() || "Otros"))]
    .sort((a, b) => a.localeCompare(b, "es"));
  categories.forEach((category, index) => sections.push({
    id: slugify(category, index), title: category,
    products: visible.filter((product) => (String(product.category || "Otros").trim() || "Otros") === category),
  }));
  return sections;
}

function renderMenu() {
  const grid = $("#products-grid");
  const sections = getMenuSections();
  grid.innerHTML = "";
  if (!sections.length) {
    const empty = document.createElement("div");
    empty.className = "menu-status menu-empty";
    empty.textContent = "Sin resultados";
    empty.setAttribute("role", "status");
    grid.appendChild(empty);
  }
  sections.forEach(({ id, title, products: sectionProducts }) => {
    const section = document.createElement("section");
    section.id = id;
    section.className = "category-group";
    const heading = document.createElement("div");
    heading.className = "category-heading";
    const titleElement = document.createElement("h3");
    titleElement.textContent = title;
    const count = document.createElement("span");
    count.textContent = `${sectionProducts.length} productos`;
    heading.appendChild(titleElement);
    heading.appendChild(count);
    const sectionGrid = document.createElement("div");
    sectionGrid.className = "category-products";
    sectionProducts.forEach((product) => sectionGrid.appendChild(renderProductCard(product)));
    section.appendChild(heading);
    section.appendChild(sectionGrid);
    grid.appendChild(section);
  });
  $(".menu-filter").classList.toggle("hidden", !sections.some((section) => section.id === "featured-section"));
  const hasFavorites = sections.some((section) => section.id === "favorites-section");
  $("#menu-favorites").classList.toggle("hidden", !hasFavorites);
  $("#header-favorites").classList.toggle("hidden", !hasFavorites);
  renderCategoryNavigation(sections);
  observeCategorySections(sections);
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
  const terminal = document.querySelector('input[name="payment"][value="Terminal (tarjeta)"]');
  const isDelivery = selected === "delivery";
  terminal.closest("label").classList.toggle("hidden", isDelivery);
  terminal.disabled = isDelivery;
  if (isDelivery && terminal.checked) {
    terminal.checked = false;
    $("#payment-error").textContent = "Terminal no está disponible a domicilio. Elige otra forma de pago.";
  }
  if (isDelivery) autofillDeliveryAddress();
  if (selected !== "delivery") {
    $("#delivery-error") && ($("#delivery-error").textContent = "");
  }
}

function normalizeAddress(value) {
  if (!value || typeof value !== "object") return null;
  const address = Object.fromEntries(ADDRESS_FIELDS.map((field) => [field, String(value[field] || "").trim()]));
  return ADDRESS_FIELDS.every((field) => address[field]) ? address : null;
}

function readLocalAddress(userId) {
  try {
    const saved = JSON.parse(localStorage.getItem(ADDRESS_STORAGE_KEY) || "null");
    return saved?.user_id === userId ? normalizeAddress(saved) : null;
  } catch {
    return null;
  }
}

async function getSavedAddress() {
  const userId = currentUser?.id;
  if (!userId) return null;
  const local = readLocalAddress(userId);
  if (local) return local;
  if (!addressLookup || addressLookupUserId !== userId) {
    addressLookupUserId = userId;
    addressLookup = (async () => {
      const { data, error } = await supabaseClient.from("orders")
        .select("fraccionamiento, calle, numero")
        .eq("user_id", userId)
        .eq("delivery_type", "delivery")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return normalizeAddress(data);
    })();
  }
  try {
    const address = await addressLookup;
    if (currentUser?.id !== userId) return null;
    // Si guardó una dirección mientras se consultaba, esa tiene prioridad.
    return readLocalAddress(userId) || address;
  } catch (error) {
    if (addressLookupUserId === userId) addressLookup = null;
    throw error;
  }
}

function writeSavedAddress(address) {
  try {
    localStorage.setItem(ADDRESS_STORAGE_KEY, JSON.stringify({ user_id: currentUser.id, ...address }));
    addressLookupUserId = currentUser.id;
    addressLookup = Promise.resolve(address);
    return true;
  } catch {
    return false;
  }
}

async function autofillDeliveryAddress() {
  if (cartAddressInitialized || cartAddressEdited) return;
  const userId = currentUser?.id;
  try {
    const address = await getSavedAddress();
    if (currentUser?.id !== userId || cartAddressEdited) return;
    if (address) ADDRESS_FIELDS.forEach((field) => { $(`#delivery-${field}`).value = address[field]; });
    cartAddressInitialized = true;
  } catch {
    if (currentUser?.id === userId) {
      $("#delivery-error").textContent = "No se pudo recuperar tu dirección. Puedes escribirla aquí.";
    }
  }
}

async function loadProfileAddress() {
  const userId = currentUser?.id;
  if (profileAddressEdited) return;
  $("#address-feedback").textContent = "Cargando dirección…";
  try {
    const address = await getSavedAddress();
    if (currentUser?.id !== userId || profileAddressEdited) return;
    ADDRESS_FIELDS.forEach((field) => { $(`#address-${field}`).value = address?.[field] || ""; });
    $("#address-feedback").textContent = address ? "" : "Aún no tienes una dirección guardada.";
  } catch {
    if (currentUser?.id === userId) $("#address-feedback").textContent = "No se pudo recuperar tu dirección. Puedes escribirla y guardarla.";
  }
}

function saveProfileAddress(event) {
  event.preventDefault();
  if (!currentUser?.id) return;
  const address = normalizeAddress(Object.fromEntries(ADDRESS_FIELDS.map((field) => [field, $(`#address-${field}`).value])));
  if (!address) {
    $("#address-feedback").textContent = "Completa fraccionamiento, calle y número.";
    return;
  }
  if (!writeSavedAddress(address)) {
    $("#address-feedback").textContent = "Este navegador no permitió guardar la dirección.";
    return;
  }
  profileAddressEdited = false;
  // No sustituir una dirección temporal que el cliente ya editó en el carrito.
  if (!cartAddressEdited) {
    ADDRESS_FIELDS.forEach((field) => { $(`#delivery-${field}`).value = address[field]; });
    cartAddressInitialized = true;
  }
  $("#address-feedback").textContent = "Dirección guardada en este dispositivo.";
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
      loadProfileAddress();
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

function renderCategoryNavigation(sections) {
  const chips = $("#category-chips");
  const menuList = $("#category-menu-list");
  if (!chips || !menuList) return;

  chips.innerHTML = "";
  menuList.innerHTML = "";
  chips.classList.toggle("hidden", sections.length === 0);

  const exploreTab = document.createElement("button");
  exploreTab.className = "category-chip category-tab active";
  exploreTab.type = "button";
  exploreTab.dataset.section = "menu-top";
  exploreTab.textContent = "Explora el menú";
  exploreTab.addEventListener("click", () => scrollToSection("menu-top"));
  chips.appendChild(exploreTab);

  sections.forEach(({ title, id: sectionId }) => {
    const chip = document.createElement("button");
    chip.className = "category-chip category-tab";
    chip.type = "button";
    chip.dataset.section = sectionId;
    chip.textContent = title;
    chip.addEventListener("click", () => scrollToSection(sectionId));
    chips.appendChild(chip);

    const menuItem = document.createElement("button");
    menuItem.className = "side-menu-item";
    menuItem.type = "button";
    menuItem.textContent = title;
    menuItem.addEventListener("click", () => {
      closeMenu();
      scrollToSection(sectionId);
    });
    menuList.appendChild(menuItem);
  });

}

function setActiveCategoryTab(sectionId) {
  $$(".category-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.section === sectionId);
  });
}

function observeCategorySections(sections) {
  categoryObserver?.disconnect();
  if (!("IntersectionObserver" in window)) return;

  const sectionIds = [
    "menu-top",
    ...sections.map((section) => section.id),
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
      <span class="cashback-badge">Gana $${money((product.price * CASHBACK_PERCENT) / 100)} aquí (5%)</span>
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
  renderMenu();
}

async function loadProducts() {
  const grid = $("#products-grid");
  let { data, error } = await supabaseClient
    .from("products")
    .select("*")
    .eq("active", true)
    .eq("activo", true)
    .order("category");

  if (error || !data || data.length === 0) {
    console.error("No se pudo consultar products con active=true:", error);
    const fallback = await supabaseClient
      .from("products")
      .select("*")
      .eq("active", true)
      .eq("activo", true)
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

  renderMenu();
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
    <p class="product-modal-price">$${money(p.price)} · <span class="cashback-badge">Gana $${money((p.price * CASHBACK_PERCENT) / 100)} (5%)</span></p>

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
  $("#cart-cashback").textContent = `$${money(subtotal * CASHBACK_PERCENT / 100)}`;
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
  const paymentMethod = document.querySelector('input[name="payment"]:checked')?.value;
  const deliveryType = document.querySelector('input[name="delivery_type"]:checked')?.value || "pickup";
  if (!paymentMethod || (deliveryType === "delivery" && paymentMethod === "Terminal (tarjeta)")) {
    $("#payment-error").textContent = deliveryType === "delivery"
      ? "Elige Efectivo, Transferencia o Pago en línea para tu pedido a domicilio."
      : "Elige una forma de pago.";
    return;
  }
  $("#payment-error").textContent = "";
  const delivery = {
    fraccionamiento: $("#delivery-fraccionamiento")?.value.trim() || "",
    calle: $("#delivery-calle")?.value.trim() || "",
    numero: $("#delivery-numero")?.value.trim() || "",
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
      cashback_percent: CASHBACK_PERCENT,
    }));
    const { error: itemsErr } = await supabaseClient.from("order_items").insert(itemsPayload);
    if (itemsErr) throw itemsErr;
    if (deliveryType === "delivery") {
      const saved = writeSavedAddress(delivery);
      if (!saved) showToast("Pedido registrado, pero no se pudo guardar la dirección en este dispositivo.");
      cartAddressEdited = false;
      cartAddressInitialized = true;
      profileAddressEdited = false;
      ADDRESS_FIELDS.forEach((field) => { $(`#address-${field}`).value = delivery[field]; });
      $("#address-feedback").textContent = saved ? "Dirección actualizada." : "No se pudo guardar la dirección en este dispositivo.";
    }

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
