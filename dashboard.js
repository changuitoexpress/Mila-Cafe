const SUPABASE_URL = "https://jspmxmaeaswnumxyetcu.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_M_cDBeTCWqnii7cvT0y6bQ_C4lsVijO";
const SESSION_STORAGE_KEY = "milaCafeSession";
const supabaseDashboardClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let allOrders = [];
let profileMap = new Map();
let productMap = new Map();
let orderItemsMap = new Map();
let dashboardLoading = false;

const $ = (selector) => document.querySelector(selector);
const money = (value) => Number(value || 0).toFixed(2);

function getSession() {
  try {
    const saved = localStorage.getItem(SESSION_STORAGE_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

function setAccessMessage(message) {
  $("#dashboard-access-message").textContent = message;
}

function isToday(dateValue) {
  const date = new Date(dateValue);
  const now = new Date();
  return date.toLocaleDateString("es-MX") === now.toLocaleDateString("es-MX");
}

function formatDate(dateValue) {
  return new Date(dateValue).toLocaleString("es-MX", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeStatus(status) {
  return String(status || "pending").toLowerCase();
}

function deliveryLabel(order) {
  return order.delivery_type === "delivery" ? "Envío a domicilio" : "Pasar a recoger";
}

function addressLabel(order) {
  if (order.delivery_type !== "delivery") return "Pickup en Mila Café";
  return [order.fraccionamiento, `Calle ${order.calle}`, `No. ${order.numero}`, order.referencias]
    .filter(Boolean)
    .join(", ");
}

async function loadRelatedData(orders) {
  profileMap = new Map();
  productMap = new Map();
  orderItemsMap = new Map();

  const userIds = [...new Set(orders.map((order) => order.user_id).filter(Boolean))];
  const orderIds = orders.map((order) => order.id).filter(Boolean);

  if (userIds.length) {
    const { data, error } = await supabaseDashboardClient
      .from("profiles")
      .select("id, name, phone")
      .in("id", userIds);
    if (error) console.warn("No se pudieron cargar perfiles de pedidos:", error);
    (data || []).forEach((profile) => profileMap.set(profile.id, profile));
  }

  if (!orderIds.length) return;
  const { data: itemRows, error: itemsError } = await supabaseDashboardClient
    .from("order_items")
    .select("order_id, product_id, quantity, unit_price")
    .in("order_id", orderIds);
  if (itemsError) {
    console.warn("No se pudieron cargar productos de pedidos:", itemsError);
    return;
  }

  const productIds = [...new Set((itemRows || []).map((item) => item.product_id).filter(Boolean))];
  if (productIds.length) {
    const { data: products, error: productsError } = await supabaseDashboardClient
      .from("products")
      .select("id, name")
      .in("id", productIds);
    if (productsError) console.warn("No se pudieron cargar nombres de productos:", productsError);
    (products || []).forEach((product) => productMap.set(product.id, product));
  }

  (itemRows || []).forEach((item) => {
    if (!orderItemsMap.has(item.order_id)) orderItemsMap.set(item.order_id, []);
    orderItemsMap.get(item.order_id).push(item);
  });
}

function renderSummary() {
  const todayOrders = allOrders.filter((order) => isToday(order.created_at));
  const completedToday = todayOrders.filter((order) => normalizeStatus(order.status) === "completed");
  const pending = allOrders.filter((order) => normalizeStatus(order.status) === "pending");
  const completed = allOrders.filter((order) => normalizeStatus(order.status) === "completed");
  const sales = completedToday.reduce((total, order) => total + Number(order.total || 0), 0);

  $("#stat-sales").textContent = `$${money(sales)}`;
  $("#stat-orders").textContent = todayOrders.length;
  $("#stat-pending").textContent = pending.length;
  $("#stat-completed").textContent = completed.length;
}

function renderOrderProducts(order) {
  const items = orderItemsMap.get(order.id) || [];
  if (!items.length) return "Productos no disponibles";
  return items
    .map((item) => `${item.quantity} × ${productMap.get(item.product_id)?.name || "Producto"} ($${money(item.unit_price)})`)
    .join(" · ");
}

function renderOrders() {
  const statusFilter = $("#status-filter").value;
  const deliveryFilter = $("#delivery-filter").value;
  const orders = allOrders.filter((order) => {
    const statusMatches = statusFilter === "all" || normalizeStatus(order.status) === statusFilter;
    const deliveryMatches = deliveryFilter === "all" || (order.delivery_type || "pickup") === deliveryFilter;
    return statusMatches && deliveryMatches;
  });

  const list = $("#orders-list");
  if (!orders.length) {
    list.innerHTML = '<div class="dashboard-empty">No hay pedidos que coincidan con los filtros.</div>';
    return;
  }

  list.innerHTML = orders.map((order) => {
    const status = normalizeStatus(order.status);
    const profile = profileMap.get(order.user_id);
    const canRedeem = order.delivery_type === "delivery" && status === "pending" && order.qr_token;
    return `
      <article class="order-card">
        <div class="order-card-heading">
          <div>
            <span class="order-id">Pedido #${String(order.id).slice(0, 8)}</span>
            <time>${formatDate(order.created_at)}</time>
          </div>
          <span class="status-badge status-${status}">${status}</span>
        </div>
        <div class="order-card-grid">
          <div><span>Cliente</span><strong>${profile?.name || "Cliente"}${profile?.phone ? ` · ${profile.phone}` : ""}</strong></div>
          <div><span>Productos</span><strong>${renderOrderProducts(order)}</strong></div>
          <div><span>Total</span><strong>$${money(order.total)}</strong></div>
          <div><span>Forma de pago</span><strong>${order.payment_method || "No indicada"}</strong></div>
          <div><span>Entrega</span><strong>${deliveryLabel(order)}</strong></div>
          <div><span>Dirección</span><strong>${addressLabel(order)}</strong></div>
        </div>
        ${canRedeem ? `<button class="btn btn-primary redeem-order-btn" type="button" data-order-id="${order.id}">Entregado y pagado</button>` : ""}
      </article>
    `;
  }).join("");

  list.querySelectorAll(".redeem-order-btn").forEach((button) => {
    button.addEventListener("click", () => redeemDeliveryOrder(button.dataset.orderId, button));
  });
}

function rpcHasFailure(result) {
  const payload = Array.isArray(result) ? result[0] : result;
  return Boolean(
    payload &&
    typeof payload === "object" &&
    (payload.success === false || payload.ok === false || payload.error)
  );
}

async function redeemDeliveryOrder(orderId, button) {
  const order = allOrders.find((candidate) => String(candidate.id) === String(orderId));
  if (!order?.qr_token) {
    $("#dashboard-feedback").textContent = "Este pedido no tiene token QR para validar.";
    return;
  }

  button.disabled = true;
  button.textContent = "Validando…";
  const { data, error } = await supabaseDashboardClient.rpc("redeem_order", {
    p_qr_token: order.qr_token,
  });

  if (error || rpcHasFailure(data)) {
    console.error("redeem_order falló:", error || data);
    $("#dashboard-feedback").textContent = `No se pudo validar el pedido: ${error?.message || "respuesta rechazada por Supabase"}.`;
    button.disabled = false;
    button.textContent = "Entregado y pagado";
    return;
  }

  $("#dashboard-feedback").textContent = "Pedido completado: saldo y transacción actualizados por redeem_order.";
  await loadDashboard();
}

async function loadDashboard() {
  if (dashboardLoading) return;
  dashboardLoading = true;
  try {
    const { data, error } = await supabaseDashboardClient
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;

    allOrders = data || [];
    await loadRelatedData(allOrders);
    renderSummary();
    renderOrders();
    $("#last-updated").textContent = `Actualizado ${new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}`;
  } catch (error) {
    console.error("No se pudo cargar el dashboard:", error);
    $("#dashboard-feedback").textContent = `No se pudieron cargar los pedidos: ${error.message || error}.`;
  } finally {
    dashboardLoading = false;
  }
}

async function initDashboard() {
  const session = getSession();
  if (!session?.id) {
    setAccessMessage("Inicia sesión desde el menú principal para continuar.");
    return;
  }

  const { data: profile, error } = await supabaseDashboardClient
    .from("profiles")
    .select("id, name, is_admin")
    .eq("id", session.id)
    .single();
  if (error || !profile) {
    setAccessMessage("No se pudo comprobar tu perfil de administrador.");
    return;
  }
  if (profile.is_admin !== true) {
    setAccessMessage("Este perfil no tiene permisos de administrador.");
    return;
  }

  $("#admin-name").textContent = profile.name || "Administrador";
  $("#dashboard-access").classList.add("hidden");
  $("#dashboard-content").classList.remove("hidden");
  $("#refresh-dashboard").addEventListener("click", loadDashboard);
  $("#status-filter").addEventListener("change", renderOrders);
  $("#delivery-filter").addEventListener("change", renderOrders);
  $("#dashboard-logout").addEventListener("click", () => {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    window.location.href = "index.html";
  });

  await loadDashboard();
  window.setInterval(loadDashboard, 12000);
}

initDashboard();