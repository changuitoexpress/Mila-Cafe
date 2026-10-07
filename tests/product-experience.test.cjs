const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const vm = require("node:vm");
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const product = () => ({ id: "p", name: "Latte", category: "Café", price: 50, active: true, activo: true });
function environment(admin = false) {
  const dom = new JSDOM(read(admin ? "dashboard.html" : "index.html"), {
    url: "https://mila.test/", runScripts: "outside-only",
  });
  const w = dom.window;
  // Evaluate as classic script tags, not eval blocks with isolated lexical scope.
  const context = dom.getInternalVMContext();
  w.eval = (code) => vm.runInContext(code, context);
  const fixture = {
    products: [product()],
    product_option_groups: [{product_id:"p",group_id:"milk",activo:true}],
    option_groups: [{id:"milk",nombre:"Tipo de leche",obligatorio:true,max_opciones:1,orden:0,activo:true}],
    options: [{id:"oat",group_id:"milk",nombre:"Avena",precio_extra:20,orden:0,activo:true},
      {id:"whole",group_id:"milk",nombre:"Entera",precio_extra:0,orden:1,activo:true}],
    product_images: [], orders: [], order_items: [], profiles: [],
  };
  const calls = [], rpcCalls = [], uploads = [], errors = [];
  let rpcFailure = null, serial = 0;
  const client = {
    from(table) {
      const query = { table, operation: "select", filters: [], payload: null };
      calls.push(query);
      const chain = {
        select(fields) { query.fields = fields; return this; },
        eq(key, value) { query.filters.push([key,value]); return this; },
        in(key, value) { query.filters.push([key,value]); return this; },
        order(key, direction = {}) { query.sort = [key,direction]; return this; },
        limit(value) { query.limit = value; return this; },
        insert(payload) { query.operation = "insert"; query.payload = payload; return this; },
        async execute(single = false) {
          let rows;
          if (query.operation === "insert") {
            rows = Array.isArray(query.payload) ? query.payload : [{id:"order",created_at:new Date().toISOString(),...query.payload}];
            fixture[table].push(...rows);
          } else {
            rows = (fixture[table] || []).filter((row) => query.filters.every(([key,value]) =>
              Array.isArray(value) ? value.includes(row[key]) : row[key] === value));
            if (query.sort) rows = [...rows].sort((a,b) => (Number(a[query.sort[0]]) || 0) - (Number(b[query.sort[0]]) || 0));
            if (query.limit) rows = rows.slice(0, query.limit);
            if (table === "orders") rows = rows.map((order) => ({
              ...order, total: fixture.order_items.reduce((sum, item) => sum + item.unit_price * item.quantity, 0),
              cashback_earned: fixture.order_items.reduce((sum, item) => sum + item.unit_price * item.quantity * 0.05, 0),
            }));
          }
          return {data:single ? rows[0] || null : rows,error:null};
        },
        single() { return this.execute(true); },
        maybeSingle() { return this.execute(true); },
        then(resolve, reject) { return this.execute().then(resolve,reject); },
      };
      return chain;
    },
    async rpc(name, args) {
      rpcCalls.push({name,args});
      if (rpcFailure) { const message = rpcFailure; rpcFailure = null; return {data:{ok:false,error:message},error:null}; }
      let data;
      if (name === "admin_set_product_option_group") {
        let row = fixture.product_option_groups.find((item) => item.product_id === args.p_product_id && item.group_id === args.p_group_id);
        if (!row) { row = {product_id:args.p_product_id,group_id:args.p_group_id}; fixture.product_option_groups.push(row); }
        row.activo = args.p_asignado;
        data = row;
      } else if (name === "admin_save_option_group" || name === "admin_save_option") {
        const table = name === "admin_save_option_group" ? "option_groups" : "options";
        let row = fixture[table].find((item) => item.id === args.p_id);
        if (!row) { row = {id:`created-${++serial}`}; fixture[table].push(row); }
        Object.entries(args).filter(([key]) => !["p_admin_id","p_pin","p_id"].includes(key))
          .forEach(([key,value]) => { row[key.slice(2)] = value; });
        data = row;
      } else {
        const p = fixture.products.find((item) => item.id === args.p_product_id);
        let photos = fixture.product_images.filter((item) => item.product_id === p.id).sort((a,b) => a.orden-b.orden);
        if (name === "admin_add_product_image") {
          if (!photos.length && p.image_url) photos.push({id:`photo-${++serial}`,product_id:p.id,url:p.image_url,orden:0});
          photos.push({id:`photo-${++serial}`,product_id:p.id,url:args.p_url,orden:photos.length});
        } else if (name === "admin_reorder_product_images") {
          photos = args.p_image_ids.map((id,index) => ({...photos.find((photo) => photo.id === id),orden:index}));
        } else if (name === "admin_delete_product_image") photos = photos.filter((photo) => photo.id !== args.p_image_id);
        else if (name === "admin_clear_product_main_image") photos.shift();
        else throw new Error(`Unexpected RPC: ${name}`);
        fixture.product_images = fixture.product_images.filter((item) => item.product_id !== p.id).concat(photos);
        p.image_url = photos[0]?.url || null;
        data = photos;
      }
      return {data:{ok:true,data},error:null};
    },
    storage: {from() {return {
      async upload(name, blob) { uploads.push({name,size:blob.size}); return {error:null}; },
      getPublicUrl(name) {return {data:{publicUrl:`https://images.test/${name}`}};},
    };}},
  };
  w.supabase = {createClient:() => client};
  w.console.error = (...messages) => errors.push(messages);
  w.setTimeout = () => 1;
  w.clearTimeout = () => {};
  w.confirm = () => true;
  w.HTMLElement.prototype.scrollIntoView = function() { this.scrolledIntoView = true; };
  w.HTMLElement.prototype.scrollTo = function({left}) { this.scrollLeft = left; this.dispatchEvent(new w.Event("scroll")); };
  w.eval(read("product-media.js"));
  w.eval(read("product-customization.js"));
  if (admin) {
    ["dashboard.js","dashboard-media.js","dashboard-options.js","dashboard-catalog.js"].forEach((file) => w.eval(read(file)));
    w.eval('adminId = "test-admin"; adminPin = "123456";');
    w.AdminMedia.init();
    w.AdminOptions.init();
  } else {
    w.eval(read("client-product-sheet.js"));
    w.eval(read("main.js"));
    w.eval('currentUser = {id:"customer",name:"Prueba",phone:"0000000000",wallet_balance:0}; cart = [];');
  }
  const $ = (selector) => w.document.querySelector(selector);
  const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };
  const change = (selector, value) => { const input = $(selector); input.value = value; input.dispatchEvent(new w.Event("change",{bubbles:true})); };
  return {dom,w,fixture,calls,rpcCalls,uploads,errors,$,flush,change,failRpc: (message) => { rpcFailure = message; }};
}

test("only active assignments, active groups and active options reach the customer", async () => {
  const h = environment();
  h.fixture.product_option_groups.push({product_id:"p",group_id:"unassigned",activo:false},{product_id:"p",group_id:"hidden",activo:true});
  h.fixture.option_groups.push({id:"unassigned",nombre:"No asignado",activo:true},{id:"hidden",nombre:"Oculto",activo:false});
  h.fixture.options.push({id:"hidden-option",group_id:"milk",nombre:"Oculta",precio_extra:99,activo:false});
  const map = await h.w.MilaOptions.load(h.w.supabase.createClient(), ["p"]);
  assert.deepEqual(Array.from(map.get("p"), (group) => group.id), ["milk"]);
  assert.deepEqual(Array.from(map.get("p")[0].options, (option) => option.id), ["oat","whole"]);
  for (const table of ["product_option_groups","option_groups","options"]) {
    assert.ok(h.calls.find((call) => call.table === table).filters.some(([key,value]) => key === "activo" && value === true));
  }
  h.dom.window.close();
});

test("product sheet highlights missing mandatory selections and prices extras and quantity live", async () => {
  const h = environment();
  h.w.eval(`openProductModal(${JSON.stringify(product())})`);
  await h.flush();
  assert.equal(h.$("#product-sheet-footer").parentElement, h.$("#modal-product-body").parentElement);
  assert.match(h.$("#sheet-add").textContent, /Agregar 1 al carrito · MXN 50.00/);
  h.$("#sheet-add").click();
  assert.ok(h.$('[data-group-id="milk"].option-group').classList.contains("is-invalid"));
  h.$('[data-option-id="oat"]').click();
  h.$("#sheet-plus").click();
  assert.match(h.$("#sheet-add").textContent, /Agregar 2 al carrito · MXN 140.00/);
  h.$("#sheet-instructions").value = "Muy caliente";
  h.$('[data-allergy][value="Sin lácteos"]').click();
  h.$('[data-allergy][value="Otra"]').click();
  h.$("#sheet-add").click();
  assert.match(h.$("#sheet-allergy-error").textContent, /Describe/);
  h.$("#sheet-allergy-extra").value = "Soya";
  h.$("#sheet-add").click();
  const cart = h.w.eval("cart");
  assert.equal(cart.length, 1);
  assert.equal(cart[0].qty, 2);
  assert.equal(cart[0].unitPrice, 70);
  assert.equal(cart[0].notas, "Muy caliente");
  assert.deepEqual(Array.from(cart[0].alergias), ["Sin lácteos","Otra: Soya"]);
  assert.equal(h.w.document.body.classList.contains("product-sheet-open"), false);
  h.dom.window.close();
});

test("radio and checkbox groups enforce their maximum and optional choices can be cleared", async () => {
  const h = environment();
  h.fixture.product_option_groups.push({product_id:"p",group_id:"extras",activo:true});
  h.fixture.option_groups.push({id:"extras",nombre:"Extras",obligatorio:false,max_opciones:2,orden:1,activo:true});
  h.fixture.options.push(...["a","b","c"].map((id,orden) => ({id,group_id:"extras",nombre:id,precio_extra:5,orden,activo:true})));
  h.w.eval(`openProductModal(${JSON.stringify(product())})`);
  await h.flush();
  h.$('[data-option-id="oat"]').click();
  h.$('[data-option-id="whole"]').click();
  assert.equal(h.$('[data-option-id="oat"]').checked, false);
  h.$('[data-option-id="a"]').click();
  h.$('[data-option-id="b"]').click();
  assert.equal(h.$('[data-option-id="c"]').disabled, true);
  assert.match(h.$("#sheet-add").textContent, /MXN 60.00/);
  h.$('[data-option-id="a"]').click();
  assert.equal(h.$('[data-option-id="c"]').disabled, false);
  h.dom.window.close();
});

test("identical configurations merge but different notes, allergies or options stay as separate lines", () => {
  const h = environment();
  h.w.eval(`const testProduct = ${JSON.stringify(product())};
    addProductToCart(testProduct,1,{notas:"Caliente"});
    addProductToCart(testProduct,2,{notas:"Caliente"});
    addProductToCart(testProduct,1,{notas:"Frío"});
    addProductToCart(testProduct,1,{notas:"Caliente",alergias:["Sin gluten"]});`);
  const cart = h.w.eval("cart");
  assert.equal(cart.length,3);
  assert.equal(cart[0].qty,3);
  assert.equal(h.w.eval("cartSubtotal()"),250);
  h.w.eval("renderCart()");
  assert.equal(h.$("#cart-items").querySelectorAll(".cart-item-row").length,3);
  h.$('[data-line-index="1"]').click();
  assert.equal(h.w.eval("cart.length"),2);
  assert.equal(h.w.eval('cart[1].alergias[0]'),"Sin gluten");
  h.dom.window.close();
});

test("equal-priced different options remain separate; selection order does not change line identity", () => {
  const h = environment();
  h.w.eval(`const p = ${JSON.stringify(product())};
    p.optionGroups = [{id:"extras",max_opciones:2,options:[{id:"a"},{id:"b"}]}];
    const a = {group_id:"extras",option_id:"a",nombre:"A",precio_extra:5};
    const b = {group_id:"extras",option_id:"b",nombre:"B",precio_extra:5};
    addProductToCart(p,1,{opciones:[a]});
    addProductToCart(p,1,{opciones:[b]});
    addProductToCart(p,1,{opciones:[a,b],alergias:["Sin gluten","Sin lácteos"]});
    addProductToCart(p,1,{opciones:[b,a],alergias:["Sin lácteos","Sin gluten"]});`);
  assert.equal(h.w.eval("cart.length"),3);
  assert.equal(h.w.eval("cart[2].qty"),2);
  assert.equal(h.w.eval("cart[0].unitPrice"),55);
  h.dom.window.close();
});

test("checkout persists multiple lines, full snapshots, combined allergies and 5% on extras", async () => {
  const h = environment();
  h.w.eval(`const p = ${JSON.stringify(product())};
    const groups = [{id:"milk",obligatorio:true,max_opciones:1,options:[{id:"oat"},{id:"whole"}]}];
    p.optionGroups = groups;
    addProductToCart(p,2,{opciones:[{group_id:"milk",grupo:"Tipo de leche",option_id:"oat",nombre:"Avena",precio_extra:20}],notas:"Caliente",alergias:["Sin lácteos"]});
    addProductToCart(p,1,{opciones:[{group_id:"milk",grupo:"Tipo de leche",option_id:"whole",nombre:"Entera",precio_extra:0}],notas:"Frío",alergias:["Sin gluten"]});
    openCart();`);
  assert.equal(h.$("#cart-cashback").textContent,"$9.50");
  await h.w.eval("handleCheckout()");
  assert.equal(h.fixture.order_items.length,2);
  assert.equal(h.fixture.order_items[0].unit_price,70);
  assert.equal(h.fixture.order_items[0].quantity,2);
  assert.equal(h.fixture.order_items[0].cashback_percent,5);
  assert.equal(h.fixture.order_items[0].notas,"Caliente");
  assert.equal(h.fixture.order_items[1].notas,"Frío");
  assert.equal(h.fixture.orders[0].alergias,"Latte: Sin lácteos\nLatte: Sin gluten");
  assert.match(h.$("#ticket-detail").textContent,/Avena/);
  assert.match(h.$("#ticket-detail").textContent,/Frío/);
  const whatsapp = decodeURIComponent(h.$("#btn-whatsapp").href);
  assert.match(whatsapp,/Tipo de leche: Avena \(\+MXN 20.00\)/);
  assert.match(whatsapp,/ALERGIAS: Sin gluten/);
  assert.match(whatsapp,/Instrucciones: Caliente/);
  assert.equal(h.w.eval("cart.length"),0);
  h.dom.window.close();
});

test("checkout rechecks active catalog and blocks removed options without creating an order", async () => {
  const h = environment();
  h.w.eval(`const p = ${JSON.stringify(product())};
    p.optionGroups = [{id:"milk",obligatorio:true,max_opciones:1,options:[{id:"oat"}]}];
    addProductToCart(p,1,{opciones:[{group_id:"milk",option_id:"oat",nombre:"Avena",precio_extra:20}]});`);
  h.fixture.options[0].activo = false;
  await h.w.eval("handleCheckout()");
  assert.equal(h.fixture.orders.length,0);
  assert.equal(h.fixture.order_items.length,0);
  assert.match(h.$("#checkout-error").textContent,/ya no está disponible/);
  assert.equal(h.$("#btn-checkout").disabled,false);
  h.dom.window.close();
});

test("dashboard preserves repeated product lines and supports historical rows without snapshots", () => {
  const h = environment(true);
  h.w.eval(`productMap.set("p", {name:"Latte"});
    orderItemsMap.set("old",[
      {quantity:1,product_id:"p",unit_price:50},
      {quantity:2,product_id:"p",unit_price:70,opciones:[{grupo:"Leche",nombre:"Avena",precio_extra:20}],notas:"<script>no</script>",alergias:["Sin lácteos"]}
    ]);`);
  const html = h.w.eval('renderOrderProducts({id:"old"})');
  assert.match(html,/1 × Latte/);
  assert.match(html,/2 × Latte/);
  assert.match(html,/Avena/);
  assert.match(html,/allergy-alert/);
  assert.doesNotMatch(html,/<script>/);
  h.dom.window.close();
});

test("admin assigns, removes, creates and hides through PIN RPCs only, preserving error messages", async () => {
  const h = environment(true);
  await h.w.AdminOptions.assignments(h.fixture.products[0]);
  const assigned = h.$('[data-assign-group="milk"]');
  assigned.click();
  await h.flush();
  assert.equal(h.fixture.product_option_groups[0].activo,false);
  assert.equal(h.rpcCalls[0].name,"admin_set_product_option_group");
  assert.equal(h.rpcCalls[0].args.p_pin,"123456");
  h.$("#option-editor-open").click();
  await h.flush();
  h.$("#og-name").value = "Jarabes";
  h.$("#og-max").value = "2";
  h.$("#option-group-form").dispatchEvent(new h.w.Event("submit",{cancelable:true}));
  await h.flush();
  const newGroup = h.fixture.option_groups.find((group) => group.nombre === "Jarabes");
  assert.ok(newGroup);
  h.$("#op-name").value = "Vainilla";
  h.$("#op-price").value = "12";
  h.$("#option-form").dispatchEvent(new h.w.Event("submit",{cancelable:true}));
  await h.flush();
  const newOption = h.fixture.options.find((option) => option.nombre === "Vainilla");
  assert.equal(newOption.precio_extra,12);
  h.$(`[data-edit-option="${newOption.id}"]`).click();
  h.$("#op-active").checked = false;
  h.$("#option-form").dispatchEvent(new h.w.Event("submit",{cancelable:true}));
  await h.flush();
  assert.equal(newOption.activo,false);
  assert.ok(h.fixture.options.includes(newOption));
  h.failRpc("Mensaje exacto de la función");
  h.$("#og-active").checked = false;
  h.$("#option-group-form").dispatchEvent(new h.w.Event("submit",{cancelable:true}));
  await h.flush();
  assert.equal(h.$("#option-editor-feedback").textContent,"Mensaje exacto de la función");
  assert.equal(h.calls.some((call) => call.operation !== "select"),false);
  h.dom.window.close();
});

test("admin gallery keeps legacy principal, uploads unique sub-1MB files, reorders and clears references", async () => {
  const h = environment(true);
  h.fixture.products[0].image_url = "https://images.test/legacy.jpg";
  h.w.MilaMedia.compress = async () => new h.w.Blob(["compressed"],{type:"image/jpeg"});
  await h.w.AdminMedia.open(h.fixture.products[0]);
  Object.defineProperty(h.$("#pf-photo"),"files",{configurable:true,value:[new h.w.File(["a"],"a.png"),new h.w.File(["b"],"b.png")]});
  h.$("#pf-photo").dispatchEvent(new h.w.Event("change"));
  await h.flush();
  assert.equal(h.fixture.product_images.length,3);
  assert.equal(h.uploads.length,2);
  assert.notEqual(h.uploads[0].name,h.uploads[1].name);
  assert.ok(h.uploads.every((upload) => upload.size < 1000000));
  const last = h.fixture.product_images[2].url;
  h.$('[data-photo-main="2"]').click();
  await h.flush();
  assert.equal(h.fixture.products[0].image_url,last);
  h.$("#pf-photo-clear").click();
  await h.flush();
  assert.equal(h.fixture.product_images.length,2);
  assert.notEqual(h.fixture.products[0].image_url,last);
  h.failRpc("No se puede borrar esta foto");
  h.$('[data-photo-delete="0"]').click();
  await h.flush();
  assert.equal(h.$("#pf-photo-status").textContent,"No se puede borrar esta foto");
  assert.equal(h.calls.some((call) => call.operation !== "select"),false);
  Object.defineProperty(h.$("#pf-photo"),"files",{configurable:true,value:Array.from({length:4},() => new h.w.File(["a"],"a.png"))});
  h.$("#pf-photo").dispatchEvent(new h.w.Event("change"));
  await h.flush();
  assert.match(h.$("#pf-photo-status").textContent,/Máximo 5 fotos/);
  assert.equal(h.uploads.length,2);
  h.dom.window.close();
});

test("compression reduces quality until the JPEG is strictly below 1 MB and frees the temporary URL", async () => {
  const h = environment();
  const qualities = [], revoked = [];
  h.w.URL.createObjectURL = () => "blob:test-photo";
  h.w.URL.revokeObjectURL = (url) => revoked.push(url);
  h.w.Image = class {
    width = 4000; height = 3000;
    set src(value) { this.onload(); }
  };
  const createElement = h.w.document.createElement.bind(h.w.document);
  h.w.document.createElement = (tag) => {
    if (tag !== "canvas") return createElement(tag);
    return {
      getContext: () => ({fillRect(){},drawImage(){}}),
      toBlob(callback, type, quality) {
        assert.equal(type,"image/jpeg");
        qualities.push(quality);
        callback({size:quality > 0.7 ? 1000000 : 800000});
      },
    };
  };
  const blob = await h.w.MilaMedia.compress(new h.w.File(["a"],"a.png"));
  assert.equal(blob.size,800000);
  assert.deepEqual(qualities,[0.82,0.65]);
  assert.deepEqual(revoked,["blob:test-photo"]);
  h.dom.window.close();
});
