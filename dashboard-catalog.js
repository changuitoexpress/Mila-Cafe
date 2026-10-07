// ============================================================
// MILA CAFÉ — dashboard-catalog.js
// Pestañas Productos y Tienda del panel de administración.
// Todas las escrituras pasan por funciones admin_* (adminRpc);
// las fotos se suben al bucket público "product-images".
// ============================================================
const NEW_CATEGORY_VALUE = "__nueva__";

let adminProducts = [];
let editingProduct = null;
let storeSettings = null;
let catalogReady = false;

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

function initCatalogAdmin() {
  if (catalogReady) return;
  catalogReady = true;
  $("#product-search").addEventListener("input", renderAdminProducts);
  $("#product-category-filter").addEventListener("change", renderAdminProducts);
  $("#product-add").addEventListener("click", () => openProductForm(null));
  $("#product-modal-close").addEventListener("click", closeProductForm);
  $("#product-modal").addEventListener("click", (event) => {
    if (event.target.id === "product-modal") closeProductForm();
  });
  $("#pf-category").addEventListener("change", syncNewCategoryField);
  window.AdminMedia.init();
  $("#product-form").addEventListener("submit", saveProductForm);
  $("#store-form").addEventListener("submit", saveStoreForm);
  $("#store-toggle").addEventListener("click", toggleStoreOpen);
}

// ---------------------------- PRODUCTOS ----------------------------
async function loadAdminProducts() {
  const feedback = $("#product-feedback");
  feedback.textContent = "Cargando productos…";
  // Sin filtro por activo: el administrador ve también los ocultos.
  const { data, error } = await supabaseDashboardClient
    .from("products")
    .select("*")
    .order("orden", { ascending: true })
    .order("name", { ascending: true });
  if (error) {
    console.error("No se pudieron cargar los productos:", error);
    feedback.textContent = `No se pudieron cargar los productos: ${error.message}.`;
    return;
  }
  adminProducts = data || [];
  feedback.textContent = "";
  fillCategoryFilter();
  renderAdminProducts();
}

function productCategories() {
  return [...new Set(adminProducts.map((p) => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
}

function isProductActive(product) {
  return product.activo !== false && product.active !== false;
}

function fillCategoryFilter() {
  const select = $("#product-category-filter");
  const current = select.value || "all";
  select.innerHTML = `<option value="all">Todas las categorías</option>` +
    productCategories().map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  select.value = [...select.options].some((o) => o.value === current) ? current : "all";
}

function renderAdminProducts() {
  const term = $("#product-search").value.trim().toLowerCase();
  const category = $("#product-category-filter").value;
  const list = adminProducts.filter((p) =>
    (category === "all" || p.category === category) &&
    (!term || `${p.name} ${p.category} ${p.description || ""}`.toLowerCase().includes(term))
  );
  const container = $("#admin-products");
  if (!list.length) {
    container.innerHTML = '<div class="dashboard-empty">No hay productos que coincidan.</div>';
    return;
  }
  container.innerHTML = list.map((p) => {
    const active = isProductActive(p);
    const thumb = p.image_url
      ? `<img class="admin-product-thumb" src="${escapeHtml(p.image_url)}" alt="" loading="lazy" />`
      : '<div class="admin-product-thumb admin-product-thumb-empty" aria-hidden="true">☕</div>';
    return `
      <article class="admin-product ${active ? "" : "is-hidden"}" data-id="${p.id}">
        ${thumb}
        <div class="admin-product-info">
          <strong>${escapeHtml(p.name)}${p.destacado ? ' <span class="star" title="Destacado">★</span>' : ""}</strong>
          <span>${escapeHtml(p.category || "Sin categoría")} · $${money(p.price)} · cashback 5% · orden ${p.orden ?? 0}</span>
        </div>
        <div class="admin-product-actions">
          <label class="switch" title="${active ? "Activo" : "Oculto"}">
            <input type="checkbox" data-product-toggle="${p.id}" ${active ? "checked" : ""} aria-label="Activo o oculto: ${escapeHtml(p.name)}" />
            <span class="switch-track"></span>
            <span class="switch-text">${active ? "Activo" : "Oculto"}</span>
          </label>
          <button class="btn btn-secondary" type="button" data-product-edit="${p.id}">Editar</button>
        </div>
      </article>`;
  }).join("");
  container.querySelectorAll("[data-product-edit]").forEach((btn) =>
    btn.addEventListener("click", () => openProductForm(adminProducts.find((p) => p.id === btn.dataset.productEdit))));
  container.querySelectorAll("[data-product-toggle]").forEach((input) =>
    input.addEventListener("change", () => toggleProductActive(input)));
}

async function toggleProductActive(input) {
  const product = adminProducts.find((p) => p.id === input.dataset.productToggle);
  const wantActive = input.checked;
  const feedback = $("#product-feedback");
  if (!wantActive && !window.confirm(`¿Ocultar "${product.name}"? Los clientes ya no lo verán; no se borra y puedes reactivarlo.`)) {
    input.checked = true;
    return;
  }
  input.disabled = true;
  try {
    await adminRpc("admin_set_product_active", { p_id: product.id, p_activo: wantActive });
    feedback.textContent = wantActive ? `"${product.name}" ya está activo.` : `"${product.name}" quedó oculto.`;
    await loadAdminProducts();
  } catch (error) {
    console.error(error);
    feedback.textContent = `No se pudo cambiar el producto: ${error.message}.`;
    input.checked = !wantActive;
    input.disabled = false;
  }
}

function fillFormCategories(selected) {
  const categories = productCategories();
  const select = $("#pf-category");
  select.innerHTML = categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("") +
    `<option value="${NEW_CATEGORY_VALUE}">+ Crear categoría nueva…</option>`;
  select.value = selected && categories.includes(selected) ? selected : (categories[0] || NEW_CATEGORY_VALUE);
  syncNewCategoryField();
}

function syncNewCategoryField() {
  const isNew = $("#pf-category").value === NEW_CATEGORY_VALUE;
  $("#pf-new-category-wrap").classList.toggle("hidden", !isNew);
  if (isNew) $("#pf-new-category").focus();
}

function openProductForm(product) {
  if (window.AdminMedia.isBusy()) return;
  editingProduct = product;
  $("#product-modal-title").textContent = product ? "Editar producto" : "Agregar producto";
  $("#pf-error").textContent = "";
  $("#pf-name").value = product?.name || "";
  fillFormCategories(product?.category);
  $("#pf-new-category").value = "";
  $("#pf-price").value = product ? product.price : "";
  $("#pf-cashback").value = 5;
  $("#pf-orden").value = product?.orden ?? 0;
  $("#pf-description").value = product?.description || "";
  $("#pf-destacado").checked = product?.destacado === true;
  $("#pf-activo").checked = product ? isProductActive(product) : true;
  $("#pf-photo").value = "";
  $("#pf-photo-status").textContent = "";
  window.AdminMedia.open(product);
  $("#product-modal").classList.remove("hidden");
  $("#pf-name").focus();
}

function closeProductForm() {
  if (window.AdminMedia.isBusy()) return;
  $("#product-modal").classList.add("hidden");
}

async function saveProductForm(event) {
  event.preventDefault();
  if (window.AdminMedia.isBusy()) return;
  const errorBox = $("#pf-error");
  const saveButton = $("#pf-save");
  errorBox.textContent = "";

  const selected = $("#pf-category").value;
  const category = selected === NEW_CATEGORY_VALUE ? $("#pf-new-category").value.trim() : selected;
  if (!category) {
    errorBox.textContent = "Escribe el nombre de la nueva categoría.";
    return;
  }

  saveButton.disabled = true;
  saveButton.textContent = "Guardando…";
  try {
    await adminRpc("admin_save_product", {
      p_id: editingProduct?.id || null,
      p_name: $("#pf-name").value.trim(),
      p_category: category,
      p_price: Number($("#pf-price").value),
      p_cashback_percent: 5,
      p_description: $("#pf-description").value.trim(),
      p_image_url: null,
      p_destacado: $("#pf-destacado").checked,
      p_orden: Math.trunc(Number($("#pf-orden").value) || 0),
      p_activo: $("#pf-activo").checked,
    });
    closeProductForm();
    $("#product-feedback").textContent = editingProduct ? "Producto actualizado." : "Producto agregado.";
    await loadAdminProducts();
  } catch (error) {
    console.error(error);
    errorBox.textContent = error.message;
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "Guardar producto";
  }
}

// ----------------------------- TIENDA -----------------------------
function renderStoreToggle() {
  const button = $("#store-toggle");
  const open = storeSettings?.abierto === true;
  button.textContent = open ? "Tienda ABIERTA — toca para cerrar" : "Tienda CERRADA — toca para abrir";
  button.classList.toggle("is-open", open);
  button.setAttribute("aria-pressed", String(open));
}

async function loadStoreSettings() {
  const feedback = $("#store-feedback");
  const { data, error } = await supabaseDashboardClient.from("store_settings").select("*").eq("id", 1).single();
  if (error) {
    console.error(error);
    feedback.textContent = `No se pudo cargar la tienda: ${error.message}.`;
    return;
  }
  storeSettings = data;
  $("#store-costo-envio").value = data.costo_envio ?? 0;
  $("#store-tiempo").value = data.tiempo_estimado_min ?? "";
  $("#store-minimo").value = data.pedido_minimo ?? 0;
  $("#store-whatsapp").value = data.whatsapp || "";
  $("#store-horario").value = data.horario || "";
  $("#store-direccion").value = data.direccion || "";
  $("#store-aviso").value = data.aviso || "";
  renderStoreToggle();
}

function storeParams(overrides = {}) {
  const tiempo = $("#store-tiempo").value;
  return {
    p_abierto: storeSettings.abierto === true,
    p_costo_envio: Number($("#store-costo-envio").value) || 0,
    p_tiempo_estimado_min: tiempo === "" ? null : Math.trunc(Number(tiempo)),
    p_pedido_minimo: Number($("#store-minimo").value) || 0,
    p_horario: $("#store-horario").value,
    p_direccion: $("#store-direccion").value,
    p_whatsapp: $("#store-whatsapp").value.replace(/\D/g, ""),
    p_aviso: $("#store-aviso").value,
    ...overrides,
  };
}

async function toggleStoreOpen() {
  if (!storeSettings) return;
  const button = $("#store-toggle");
  const feedback = $("#store-feedback");
  const wantOpen = storeSettings.abierto !== true;
  if (!wantOpen && !window.confirm("¿Cerrar la tienda? Los clientes no podrán hacer pedidos.")) return;
  button.disabled = true;
  try {
    // Solo cambia el interruptor: el resto usa los valores ya guardados.
    await adminRpc("admin_update_store_settings", {
      p_abierto: wantOpen,
      p_costo_envio: Number(storeSettings.costo_envio) || 0,
      p_tiempo_estimado_min: storeSettings.tiempo_estimado_min,
      p_pedido_minimo: Number(storeSettings.pedido_minimo) || 0,
      p_horario: storeSettings.horario || "",
      p_direccion: storeSettings.direccion || "",
      p_whatsapp: storeSettings.whatsapp || "",
      p_aviso: storeSettings.aviso || "",
    });
    feedback.textContent = wantOpen ? "Tienda abierta." : "Tienda cerrada.";
    await loadStoreSettings();
  } catch (error) {
    console.error(error);
    feedback.textContent = `No se pudo cambiar el estado de la tienda: ${error.message}.`;
  } finally {
    button.disabled = false;
  }
}

async function saveStoreForm(event) {
  event.preventDefault();
  if (!storeSettings) return;
  const feedback = $("#store-feedback");
  const submit = $("#store-form button[type=submit]");
  submit.disabled = true;
  try {
    await adminRpc("admin_update_store_settings", storeParams());
    feedback.textContent = "Tienda guardada.";
    await loadStoreSettings();
  } catch (error) {
    console.error(error);
    feedback.textContent = `No se pudo guardar la tienda: ${error.message}.`;
  } finally {
    submit.disabled = false;
  }
}
