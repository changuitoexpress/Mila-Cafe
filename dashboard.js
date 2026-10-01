const SUPABASE_URL = "https://jspmxmaeaswnumxyetcu.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_M_cDBeTCWqnii7cvT0y6bQ_C4lsVijO";
const SESSION_STORAGE_KEY = "milaCafeSession";
const supabaseDashboardClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let allOrders = [];
let profileMap = new Map();
let productMap = new Map();
let orderItemsMap = new Map();
let dashboardLoading = false;
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

function setAccessMessage(message) {
  $("#dashboard-access-message").textContent = message;
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
    const canRedeem = status === "pending" && order.qr_token;
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
    button.addEventListener("click", () => redeemOrder(button.dataset.orderId, button));
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

async function redeemOrder(orderId, button) {
  const order = allOrders.find((candidate) => String(candidate.id) === String(orderId));
  if (!order?.qr_token) {
    $("#dashboard-feedback").textContent = "Este pedido no tiene token interno para confirmar.";
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

  $("#admin-name").textContent = profile.name || "Administrador";
  $("#dashboard-access").classList.add("hidden");
  $("#dashboard-content").classList.remove("hidden");
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

initDashboard();