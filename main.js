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

alert('Supabase cargado: ' + (typeof window.supabase !== 'undefined'));
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Generador de imagen QR: servicio gratuito, no requiere instalar nada.
// Solo le mandamos el texto (el token) y nos regresa una imagen PNG.
function qrImageUrl(text, size = 260) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}`;
}

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

async function handleLogin() {
  let errorEl;
  try {
    console.log("Iniciando sesión con teléfono...");
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
      alert("Error de Supabase: " + JSON.stringify(findErr));
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
        alert("Error de Supabase: " + JSON.stringify(insertErr));
        throw insertErr;
      }
      currentUser = created;
    }

    saveSession();
    startApp();
  } catch (err) {
    console.error("Error en el inicio de sesión:", err);
    alert('ERROR: ' + JSON.stringify(err && err.message ? err.message : err));
    if (errorEl) {
      errorEl.textContent = "No pudimos conectar. Revisa tu conexión o las llaves de Supabase.";
    }
  }
}

function startApp() {
  $("#view-login").classList.remove("active");
  $("#app").classList.remove("hidden");
  $$(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === "menu"));
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === "view-menu"));
  $("#user-name-tag").textContent = currentUser.name || "Cliente Mila";
  loadProducts();
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
  updateCartBadge();
  $("#app").classList.add("hidden");
  $("#view-login").classList.add("active");
  $("#phone-input").value = "";
  $("#name-input").value = "";
  $("#login-error").textContent = "";
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
    const category = (product.category || "Otros").trim() || "Otros";
    if (!groupedProducts.has(category)) groupedProducts.set(category, []);
    groupedProducts.get(category).push(product);
  });

  groupedProducts.forEach((categoryProducts, category) => {
    const group = document.createElement("section");
    group.className = "category-group";

    const heading = document.createElement("div");
    heading.className = "category-heading";
    heading.innerHTML = `<h3></h3><span>${categoryProducts.length} productos</span>`;
    heading.querySelector("h3").textContent = category;

    const categoryGrid = document.createElement("div");
    categoryGrid.className = "category-products";

    categoryProducts.forEach((p) => {
      const card = document.createElement("div");
      card.className = "product-card";
      card.innerHTML = `
        <span class="cat">${p.category || "Café"}</span>
        <h3>${p.name}</h3>
        <p class="desc">${p.description || ""}</p>
        <div class="price-row">
          <span class="price">$${money(p.price)}</span>
          <span class="cashback-badge">Gana $${money((p.price * p.cashback_percent) / 100)} aquí</span>
        </div>
      `;
      card.addEventListener("click", () => openProductModal(p));
      categoryGrid.appendChild(card);
    });

    group.appendChild(heading);
    group.appendChild(categoryGrid);
    grid.appendChild(group);
  });
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

function addToCart() {
  const existing = cart.find((c) => c.product.id === activeProduct.id);
  if (existing) {
    existing.qty += activeQty;
  } else {
    cart.push({ product: activeProduct, qty: activeQty });
  }
  updateCartBadge();
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
// CHECKOUT — crea la orden + sus items y genera el ticket QR
// El cashback se calcula solo (trigger en Supabase).
// El saldo NO se descuenta aquí: se descuenta hasta que el
// personal valide el QR en caja (función redeem_order).
// ============================================================
$("#btn-checkout").addEventListener("click", handleCheckout);

async function handleCheckout() {
  const subtotal = cartSubtotal();
  const useWallet = $("#use-wallet-checkbox").checked;
  const walletAvailable = Number(currentUser.wallet_balance || 0);
  const walletUsed = useWallet ? Math.min(subtotal, walletAvailable) : 0;
  const paymentMethod = document.querySelector('input[name="payment"]:checked').value;

  // Guardamos una copia de los items del carrito ANTES de vaciarlo,
  // porque los necesitamos para armar el mensaje de WhatsApp.
  const cartSnapshot = cart.map((c) => ({ name: c.product.name, qty: c.qty, price: c.product.price }));

  try {
    // 1. Crear la orden (pending)
    const { data: order, error: orderErr } = await supabaseClient
      .from("orders")
      .insert({ user_id: currentUser.id, wallet_used: walletUsed, payment_method: paymentMethod })
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
    showTicket(finalOrder);
    cart = [];
    updateCartBadge();
    closeModal("#modal-cart");
  } catch (err) {
    console.error(err);
    showToast("No se pudo generar el ticket. Intenta de nuevo.");
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
  lines.push(`Cashback que ganará: $${money(order.cashback_earned)}`);
  lines.push(`Código de ticket: ${order.qr_token}`);
  return lines.join("\n");
}

function showTicket(order) {
  $("#ticket-qr").innerHTML = `<img src="${qrImageUrl(order.qr_token)}" alt="Código QR del ticket" />`;
  $("#ticket-token").textContent = order.qr_token;
  $("#ticket-detail").innerHTML = `
    <div class="row"><span>Total a pagar</span><span>$${money(order.total)}</span></div>
    <div class="row"><span>Saldo aplicado</span><span>-$${money(order.wallet_used)}</span></div>
    <div class="row"><span>Forma de pago</span><span>${order.payment_method}</span></div>
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
    .select("wallet_balance")
    .eq("id", currentUser.id)
    .single();
  if (!error && data) {
    currentUser.wallet_balance = data.wallet_balance;
    $("#wallet-balance").textContent = money(data.wallet_balance);
    saveSession();
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
