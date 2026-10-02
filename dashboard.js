const SUPABASE_URL = "https://jspmxmaeaswnumxyetcu.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_M_cDBeTCWqnii7cvT0y6bQ_C4lsVijO";
const SESSION_STORAGE_KEY = "milaCafeSession";
const supabaseDashboardClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let allOrders = [];
let profileMap = new Map();
let productMap = new Map();
let orderItemsMap = new Map();
let dashboardLoading = false;
let adminId = null;
let adminPin = null; // solo en memoria: nunca se guarda en el navegador
let alertsInitialized = false;
let seenOrderIds = new Set();
let realtimeChannel = null;
let realtimeState = "Conectando en tiempo real";
let reconnectTimer = null;
let audioContext = null;

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

// Llama a una función admin_* de Supabase. Siempre envía el id y el PIN del
// administrador. Si el PIN falla, se borra y se vuelve a pedir.
async function adminRpc(name, params = {}) {
  const { data, error } = await supabaseDashboardClient.rpc(name, {
    p_admin_id: adminId,
    p_pin: adminPin,
    ...params,
  });
  if (error) throw new Error(error.message);
  if (data && data.ok === false) {
    if (/PIN|intentos|autorizado/i.test(data.error || "")) requirePin(data.error);
    throw new Error(data.error || "Supabase rechazó la operación");
  }
  return data ? data.data : null;
}

function requirePin(message) {
  adminPin = null;
  $("#dashboard-content").classList.add("hidden");
  $("#dashboard-access").classList.remove("hidden");
  $("#pin-form").classList.remove("hidden");
  $("#dashboard-access-message").textContent = "Escribe tu PIN de administrador para continuar.";
  $("#pin-error").textContent = message || "";
  $("#admin-pin").value = "";
  $("#admin-pin").focus();
}

function setAccessMessage(message) {
  $("#dashboard-access-message").textContent = message;
}

function showTab(name) {
  document.querySelectorAll(".admin-tab").forEach((tab) => {
    const active = tab.dataset.tab === name;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll(".admin-tab-panel").forEach((panel) => {
    panel.classList.toggle("hidden", panel.id !== `tab-${name}`);
  });
  if (name === "productos" && typeof loadAdminProducts === "function") loadAdminProducts();
  if (name === "tienda" && typeof loadStoreSettings === "function") loadStoreSettings();
}

function updateAlertsStatus() {
  const sound = audioContext?.state === "running" ? "Sonido activo" : "Activa el sonido con un toque";
  const notifications = !("Notification" in window)
    ? "notificaciones no disponibles"
    : Notification.permission === "granted"
      ? "notificaciones permitidas"
      : Notification.permission === "denied"
        ? "notificaciones bloqueadas en el navegador"
        : "notificaciones sin permiso";
  $("#alerts-status").textContent = `${realtimeState} · ${sound} · ${notifications}.`;
  $("#enable-order-sound").classList.toggle("hidden", audioContext?.state === "running");
  $("#enable-order-notifications").classList.toggle(
    "hidden",
    !("Notification" in window) || Notification.permission !== "default"
  );
}

function playNewOrderSound() {
  if (audioContext?.state !== "running") return;
  for (let index = 0; index < 3; index += 1) {
    const start = audioContext.currentTime + index * 0.22;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 660 + index * 110;
    gain.gain.setValueAtTime(0.001, start);
    gain.gain.exponentialRampToValueAtTime(0.22, start + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.18);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.2);
  }
}

function announceNewOrder(order) {
  const id = String(order?.id || "");
  if (!id || seenOrderIds.has(id)) return;
  seenOrderIds.add(id);
  playNewOrderSound();
  $("#dashboard-feedback").textContent = `Nuevo pedido #${id.slice(0, 8)}.`;
  if ("Notification" in window && Notification.permission === "granted") {
    try {
      const notification = new Notification("Nuevo pedido — Mila Café", {
        body: `Pedido #${id.slice(0, 8)}. Abre el panel para revisarlo.`,
        tag: `mila-order-${id}`,
        icon: "icons/mila-icon-192.png",
      });
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    } catch (error) {
      console.warn("El navegador no permitió mostrar la notificación:", error);
    }
  }
}

function connectOrderAlerts() {
  if (realtimeChannel) return;
  realtimeState = "Conectando en tiempo real";
  updateAlertsStatus();
  const channel = supabaseDashboardClient
    .channel("mila-new-orders")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "orders" }, (payload) => {
      if (alertsInitialized) announceNewOrder(payload.new);
      window.setTimeout(loadDashboard, 100);
    });
  realtimeChannel = channel;
  channel.subscribe((status) => {
    if (realtimeChannel !== channel) return;
    if (status === "SUBSCRIBED") {
      realtimeState = "Avisos en tiempo real conectados";
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
      realtimeState = "Tiempo real no disponible; comprobando pedidos cada 12 segundos";
      if (!reconnectTimer) {
        reconnectTimer = window.setTimeout(async () => {
          reconnectTimer = null;
          realtimeChannel = null;
          await supabaseDashboardClient.removeChannel(channel);
          connectOrderAlerts();
        }, 15000);
      }
    }
    updateAlertsStatus();
  });
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
  const badge = $("#pending-badge");
  badge.textContent = pending.length;
  badge.classList.toggle("hidden", pending.length === 0);
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
    const actions = orderActions(order, status);
    return `
      <article class="order-card">
        <div class="order-card-heading">
          <div>
            <span class="order-id">Pedido #${String(order.id).slice(0, 8)}</span>
            <time>${formatDate(order.created_at)}</time>
          </div>
          <span class="status-badge status-${status}">${statusLabel(order, status)}</span>
        </div>
        <div class="order-card-grid">
          <div><span>Cliente</span><strong>${profile?.name || "Cliente"}${profile?.phone ? ` · ${profile.phone}` : ""}</strong></div>
          <div><span>Productos</span><strong>${renderOrderProducts(order)}</strong></div>
          <div><span>Total</span><strong>$${money(order.total)}</strong></div>
          <div><span>Forma de pago</span><strong>${order.payment_method || "No indicada"}</strong></div>
          <div><span>Entrega</span><strong>${deliveryLabel(order)}</strong></div>
          <div><span>Dirección</span><strong>${addressLabel(order)}</strong></div>
        </div>
        ${actions}
      </article>
    `;
  }).join("");

  list.querySelectorAll("[data-order-action]").forEach((button) => {
    button.addEventListener("click", () => runOrderAction(button));
  });
}

const STAGE_LABELS = {
  preparando: "En preparación",
  recogiendo: "Recogiendo",
  en_ruta: "En ruta",
  entregado: "Entregado",
  listo: "Listo para recoger",
};
const DELIVERY_FLOW = ["preparando", "recogiendo", "en_ruta", "entregado"];
const PICKUP_FLOW = ["preparando", "listo"];

function statusLabel(order, status) {
  if (status === "completed") return "Entregado y pagado";
  if (status === "cancelled") return "Cancelado";
  return STAGE_LABELS[order.etapa] || "Nuevo";
}

function orderActions(order, status) {
  if (status !== "pending") return "";
  const isDelivery = order.delivery_type === "delivery";
  const flow = isDelivery ? DELIVERY_FLOW : PICKUP_FLOW;
  const index = flow.indexOf(order.etapa);
  const nextStage = flow[index + 1];
  const lastStage = flow[flow.length - 1];
  let primary;
  if (nextStage) {
    primary = `<button class="btn btn-primary" type="button" data-order-action="stage" data-stage="${nextStage}" data-order-id="${order.id}">Marcar: ${STAGE_LABELS[nextStage]}</button>`;
  } else if (order.etapa === lastStage) {
    primary = `<button class="btn btn-primary" type="button" data-order-action="redeem" data-order-id="${order.id}">${isDelivery ? "Pagado" : "Entregado y pagado"}</button>`;
  }
  const cancel = `<button class="btn btn-secondary btn-danger-text" type="button" data-order-action="cancel" data-order-id="${order.id}">Cancelar pedido</button>`;
  return `<div class="order-actions">${primary || ""}${cancel}</div>`;
}

async function runOrderAction(button) {
  const orderId = button.dataset.orderId;
  const action = button.dataset.orderAction;
  const feedback = $("#dashboard-feedback");
  if (action === "cancel" && !window.confirm("¿Cancelar este pedido? Los pedidos cancelados no dan cashback.")) return;

  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Guardando…";
  try {
    if (action === "stage") {
      await adminRpc("admin_set_order_stage", { p_order_id: orderId, p_etapa: button.dataset.stage });
      feedback.textContent = "Estado del pedido actualizado.";
    } else if (action === "redeem") {
      await adminRpc("admin_redeem_order", { p_order_id: orderId });
      feedback.textContent = "Pedido pagado: saldo y cashback actualizados.";
    } else if (action === "cancel") {
      await adminRpc("admin_cancel_order", { p_order_id: orderId });
      feedback.textContent = "Pedido cancelado.";
    }
    await loadDashboard();
  } catch (error) {
    console.error("Acción de pedido falló:", error);
    feedback.textContent = `No se pudo actualizar el pedido: ${error.message}.`;
    button.disabled = false;
    button.textContent = original;
  }
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
    if (alertsInitialized) {
      allOrders.forEach(announceNewOrder);
    } else {
      seenOrderIds = new Set(allOrders.map((order) => String(order.id)));
      alertsInitialized = true;
    }
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

  adminId = profile.id;
  $("#admin-name").textContent = profile.name || "Administrador";
  $("#pin-form").classList.remove("hidden");
  $("#dashboard-access-message").textContent = "Escribe tu PIN de administrador para continuar.";
  $("#admin-pin").focus();
  $("#pin-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const pin = $("#admin-pin").value.trim();
    const submit = $("#pin-form button[type=submit]");
    submit.disabled = true;
    $("#pin-error").textContent = "";
    try {
      const { data, error } = await supabaseDashboardClient.rpc("admin_login", { p_admin_id: adminId, p_pin: pin });
      if (error) throw new Error(error.message);
      if (!data || data.ok !== true) {
        $("#pin-error").textContent = data?.error || "No se pudo validar el PIN.";
        return;
      }
      adminPin = pin;
      $("#admin-pin").value = "";
      $("#pin-form").classList.add("hidden");
      $("#dashboard-access").classList.add("hidden");
      $("#dashboard-content").classList.remove("hidden");
      if (!dashboardStarted) {
        dashboardStarted = true;
        await startDashboard();
      } else {
        await loadDashboard();
      }
    } catch (error) {
      $("#pin-error").textContent = `No se pudo validar el PIN: ${error.message}.`;
    } finally {
      submit.disabled = false;
    }
  });
}

let dashboardStarted = false;

function initChangePin() {
  const modal = $("#pin-modal");
  const message = $("#cp-message");
  const close = () => modal.classList.add("hidden");
  $("#change-pin-open").addEventListener("click", () => {
    $("#change-pin-form").reset();
    message.textContent = "";
    message.classList.add("error-text");
    modal.classList.remove("hidden");
    $("#cp-current").focus();
  });
  $("#pin-modal-close").addEventListener("click", close);
  modal.addEventListener("click", (event) => { if (event.target === modal) close(); });
  $("#change-pin-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const current = $("#cp-current").value.trim();
    const next = $("#cp-new").value.trim();
    message.classList.add("error-text");
    if (next !== $("#cp-confirm").value.trim()) {
      message.textContent = "El PIN nuevo y su confirmación no coinciden.";
      return;
    }
    const save = $("#cp-save");
    save.disabled = true;
    message.textContent = "";
    try {
      // Llamada directa: un error aquí no debe sacar al administrador del panel.
      const { data, error } = await supabaseDashboardClient.rpc("admin_change_pin", {
        p_admin_id: adminId,
        p_pin: current,
        p_new_pin: next,
      });
      if (error) throw new Error(error.message);
      if (data && data.ok === false) {
        message.textContent = data.error || "No se pudo cambiar el PIN.";
        return;
      }
      adminPin = next;
      $("#change-pin-form").reset();
      message.classList.remove("error-text");
      message.textContent = "PIN actualizado.";
    } catch (error) {
      message.textContent = error.message;
    } finally {
      save.disabled = false;
    }
  });
}

async function startDashboard() {
  document.querySelectorAll(".admin-tab").forEach((tab) => {
    tab.addEventListener("click", () => showTab(tab.dataset.tab));
  });
  if (typeof initCatalogAdmin === "function") initCatalogAdmin();
  initChangePin();
  $("#refresh-dashboard").addEventListener("click", loadDashboard);
  $("#status-filter").addEventListener("change", renderOrders);
  $("#delivery-filter").addEventListener("change", renderOrders);
  $("#dashboard-logout").addEventListener("click", () => {
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    if (realtimeChannel) supabaseDashboardClient.removeChannel(realtimeChannel);
    localStorage.removeItem(SESSION_STORAGE_KEY);
    window.location.href = "index.html";
  });
  $("#enable-order-sound").addEventListener("click", async () => {
    try {
      audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      await audioContext.resume();
    } catch (error) {
      console.warn("El navegador no permitió el sonido:", error);
    }
    updateAlertsStatus();
  });
  $("#enable-order-notifications").addEventListener("click", async () => {
    try {
      await Notification.requestPermission();
    } catch (error) {
      console.warn("No se pudo solicitar permiso de notificaciones:", error);
    }
    updateAlertsStatus();
  });
  window.addEventListener("beforeunload", () => {
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    if (realtimeChannel) supabaseDashboardClient.removeChannel(realtimeChannel);
  });

  await loadDashboard();
  updateAlertsStatus();
  connectOrderAlerts();
  window.setInterval(loadDashboard, 12000);
}
