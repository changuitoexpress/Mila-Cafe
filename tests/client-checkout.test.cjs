const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const source = (name) => fs.readFileSync(path.join(__dirname, "..", name), "utf8");

// Exercise the real scripts without network calls, credentials or database writes.
function setup(script = "main.js") {
  const elements = new Map();
  const storage = new Map();
  const calls = [];
  const responseQueue = [];
  function element(selector) {
    if (!elements.has(selector)) {
      const classes = new Set();
      elements.set(selector, {
        value: "", checked: false, disabled: false, textContent: "", style: {},
        listeners: {}, classList: {
          add: (...names) => names.forEach((name) => classes.add(name)),
          remove: (...names) => names.forEach((name) => classes.delete(name)),
          contains: (name) => classes.has(name),
          toggle(name, active) {
            const next = active === undefined ? !classes.has(name) : active;
            next ? classes.add(name) : classes.delete(name);
          },
        },
        addEventListener(name, handler) { this.listeners[name] = handler; },
        closest() { return element(`${selector}-label`); },
        setAttribute() {}, focus() {}, appendChild() {},
      });
    }
    return elements.get(selector);
  }
  const payment = ["Efectivo", "Transferencia", "Pago en línea", "Terminal (tarjeta)"]
    .map((value) => Object.assign(element(`payment-${value}`), { value }));
  const delivery = ["pickup", "delivery"]
    .map((value) => Object.assign(element(`delivery-${value}`), { value }));
  payment[0].checked = delivery[0].checked = true;
  const client = {
    from(table) {
      const call = { table, filters: [], payload: null, operation: "select" };
      calls.push(call);
      const result = responseQueue.shift() || { data: null, error: null };
      return {
        select(fields) { call.fields = fields; return this; },
        eq(...args) { call.filters.push(args); return this; },
        order(...args) { call.order = args; return this; },
        limit(value) { call.limit = value; return this; },
        insert(payload) { call.payload = payload; call.operation = "insert"; return this; },
        single() { return Promise.resolve(result); },
        maybeSingle() { return Promise.resolve(result); },
        then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
      };
    },
  };
  const context = vm.createContext({
    console, setTimeout() {}, clearTimeout() {},
    window: { supabase: { createClient: () => client } },
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    document: {
      querySelector(selector) {
        if (selector === 'input[name="payment"]:checked') return payment.find((input) => input.checked);
        if (selector === 'input[name="delivery_type"]:checked') return delivery.find((input) => input.checked);
        if (selector === 'input[name="payment"][value="Terminal (tarjeta)"]') return payment[3];
        return element(selector);
      },
      querySelectorAll(selector) {
        if (selector === 'input[name="payment"]') return payment;
        if (selector === 'input[name="delivery_type"]') return delivery;
        return [];
      },
      createElement: () => element("created"),
    },
  });
  vm.runInContext(source(script), context);
  const run = (code) => vm.runInContext(code, context);
  if (script === "main.js") run(`currentUser = {id: "client-a", name: "Prueba", phone: "0000000000", wallet_balance: 20};
    cart = [{product: {id: "product-a", name: "Café", price: 100, cashback_percent: 10}, qty: 2}];`);
  return { run, element, storage, calls, responseQueue, payment, delivery };
}
const address = { fraccionamiento: "Centro", calle: "Primera", numero: "7" };
function fillAddress(h, prefix = "delivery") {
  Object.entries(address).forEach(([field, value]) => { h.element(`#${prefix}-${field}`).value = value; });
}

test("local address has priority and another customer's stored address is ignored", async () => {
  const h = setup();
  h.storage.set("milaCafeAddress", JSON.stringify({ user_id: "client-a", ...address }));
  assert.equal((await h.run("getSavedAddress()")).numero, "7");
  assert.equal(h.calls.length, 0);
  h.storage.set("milaCafeAddress", JSON.stringify({ user_id: "client-b", ...address }));
  h.responseQueue.push({ data: { ...address, numero: "9" }, error: null });
  assert.equal((await h.run("getSavedAddress()")).numero, "9");
  assert.deepEqual(h.calls[0].filters, [["user_id", "client-a"], ["delivery_type", "delivery"]]);
  assert.equal(h.calls[0].order[0], "created_at");
  assert.equal(h.calls[0].order[1].ascending, false);
  assert.equal(h.calls[0].limit, 1);
});

test("autofill and reopening the cart preserve an address edited by the customer", async () => {
  const h = setup();
  h.storage.set("milaCafeAddress", JSON.stringify({ user_id: "client-a", ...address }));
  await h.run("autofillDeliveryAddress()");
  assert.equal(h.element("#delivery-calle").value, "Primera");
  h.element("#delivery-calle").value = "Otra";
  h.element("#delivery-calle").listeners.input();
  await h.run("autofillDeliveryAddress()");
  assert.equal(h.element("#delivery-calle").value, "Otra");
});

test("profile editing saves locally and logout erases stored and displayed addresses", async () => {
  const h = setup();
  fillAddress(h, "address");
  h.run("saveProfileAddress({preventDefault(){}})");
  assert.equal(JSON.parse(h.storage.get("milaCafeAddress")).calle, "Primera");
  assert.equal(h.element("#delivery-numero").value, "7");
  h.run("handleLogout()");
  assert.equal(h.storage.has("milaCafeAddress"), false);
  assert.equal(h.element("#address-calle").value, "");
  assert.equal(h.element("#delivery-calle").value, "");
});

test("terminal is hidden and deselected for delivery, and returns for pickup", () => {
  const h = setup();
  h.payment[0].checked = false;
  h.payment[3].checked = true;
  h.delivery[0].checked = false;
  h.delivery[1].checked = true;
  h.run("toggleDeliveryFields()");
  assert.equal(h.payment[3].checked, false);
  assert.equal(h.payment[3].disabled, true);
  assert.equal(h.payment[3].closest().classList.contains("hidden"), true);
  assert.match(h.element("#payment-error").textContent, /Elige otra/);
  assert.equal(h.payment.some((input) => input.checked), false);
  h.delivery[1].checked = false;
  h.delivery[0].checked = true;
  h.run("toggleDeliveryFields()");
  assert.equal(h.payment[3].disabled, false);
  assert.equal(h.payment[3].closest().classList.contains("hidden"), false);
});

test("checkout blocks missing payment and terminal with delivery before any insert", async () => {
  const h = setup();
  h.payment[0].checked = false;
  await h.run("handleCheckout()");
  assert.equal(h.calls.length, 0);
  h.payment[3].checked = true;
  h.delivery[0].checked = false;
  h.delivery[1].checked = true;
  await h.run("handleCheckout()");
  assert.equal(h.calls.length, 0);
  assert.match(h.element("#payment-error").textContent, /Efectivo, Transferencia/);
});

test("delivery checkout needs only three address fields, saves them and inserts 5% cashback", async () => {
  const h = setup();
  fillAddress(h);
  h.delivery[0].checked = false;
  h.delivery[1].checked = true;
  h.responseQueue.push(
    { data: { id: "order-a" }, error: null },
    { data: null, error: null },
    { data: { id: "order-a", total: 200, wallet_used: 0, cashback_earned: 10 }, error: null },
  );
  h.run("showOrderConfirmation = () => {}");
  await h.run("handleCheckout()");
  assert.equal(h.calls[0].payload.fraccionamiento, "Centro");
  assert.equal("referencias" in h.calls[0].payload, false);
  assert.equal(h.calls[1].payload[0].cashback_percent, 5);
  assert.equal(JSON.parse(h.storage.get("milaCafeAddress")).numero, "7");
  assert.deepEqual(h.calls.map((call) => call.operation), ["insert", "insert", "select"]);
});

test("cart estimates exactly 5% even for stale products and wallet use", () => {
  const h = setup();
  h.element("#use-wallet-checkbox").checked = true;
  h.run("updateCartSummary()");
  assert.equal(h.element("#cart-cashback").textContent, "$10.00");
  assert.equal(h.element("#cart-total").textContent, "$180.00");
});

test("pickup checkout accepts Terminal and does not replace the saved address", async () => {
  const h = setup();
  const stored = JSON.stringify({ user_id: "client-a", ...address });
  h.storage.set("milaCafeAddress", stored);
  h.payment[0].checked = false;
  h.payment[3].checked = true;
  h.responseQueue.push(
    { data: { id: "order-a" }, error: null },
    { data: null, error: null },
    { data: { id: "order-a", total: 200, cashback_earned: 10 }, error: null },
  );
  h.run("showOrderConfirmation = () => {}");
  await h.run("handleCheckout()");
  assert.equal(h.calls[0].payload.payment_method, "Terminal (tarjeta)");
  assert.equal(h.calls[0].payload.fraccionamiento, null);
  assert.equal(h.storage.get("milaCafeAddress"), stored);
});

test("WhatsApp omits historical references and dashboard only shows them if present", () => {
  const h = setup();
  const order = { delivery_type: "delivery", ...address, referencias: "REF_ANTIGUA", items: [], subtotal: 0 };
  h.run(`testOrder = ${JSON.stringify(order)}`);
  assert.doesNotMatch(h.run("buildWhatsappMessage(testOrder)"), /Referencias|REF_ANTIGUA/);
  const dashboard = setup("dashboard.js");
  dashboard.run(`testOrder = ${JSON.stringify(order)}`);
  assert.match(dashboard.run("addressLabel(testOrder)"), /Referencias: REF_ANTIGUA/);
  dashboard.run("testOrder.referencias = null");
  assert.doesNotMatch(dashboard.run("addressLabel(testOrder)"), /Referencias|null|undefined/);
});
