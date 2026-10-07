// Gallery references are written exclusively through the PIN-protected RPCs.
window.AdminMedia = (() => {
  let rows = [];
  let product = null;
  let version = 0;
  let busy = false;
  let loaded = false;
  const status = () => document.querySelector("#pf-photo-status");
  function render() {
    const photos = rows.length ? rows : product?.image_url ? [{ id: null, url: product.image_url }] : [];
    document.querySelector("#pf-gallery").innerHTML = photos.map((image, index) => `
      <article class="admin-gallery-photo">
        <img src="${window.MilaMedia.escape(image.url)}" alt="Foto ${index + 1}" />
        <span>${index === 0 ? "Principal" : `Foto ${index + 1}`}</span>
        <div class="photo-actions">
          ${image.id ? `<button type="button" data-photo-main="${index}" ${busy || index === 0 ? "disabled" : ""}>Principal</button>
          <button type="button" data-photo-move="${index}" data-step="-1" aria-label="Mover foto antes" ${busy || !index ? "disabled" : ""}>←</button>
          <button type="button" data-photo-move="${index}" data-step="1" aria-label="Mover foto después" ${busy || index === photos.length - 1 ? "disabled" : ""}>→</button>` : ""}
          <button type="button" data-photo-delete="${index}" ${busy ? "disabled" : ""}>Borrar</button>
        </div>
      </article>`).join("") || '<p class="muted">Sin fotos.</p>';
    document.querySelector("#pf-photo").disabled = !product?.id || busy || !loaded;
    document.querySelector("#pf-photo-clear").disabled = !photos.length || busy || !product?.id || !loaded;
    document.querySelector("#pf-gallery").querySelectorAll("[data-photo-delete]").forEach((button) =>
      button.addEventListener("click", () => mutate("delete", Number(button.dataset.photoDelete))));
    document.querySelector("#pf-gallery").querySelectorAll("[data-photo-main]").forEach((button) =>
      button.addEventListener("click", () => mutate("main", Number(button.dataset.photoMain))));
    document.querySelector("#pf-gallery").querySelectorAll("[data-photo-move]").forEach((button) =>
      button.addEventListener("click", () => mutate("move", Number(button.dataset.photoMove), Number(button.dataset.step))));
  }
  async function open(nextProduct) {
    const currentVersion = ++version;
    product = nextProduct;
    loaded = false;
    rows = [];
    busy = true;
    status().textContent = product?.id ? "Cargando fotos…" : "Guarda el producto y vuelve a editarlo para agregar fotos.";
    render();
    if (!product?.id) { busy = false; render(); return; }
    try {
      const map = await window.MilaMedia.load(supabaseDashboardClient, [product.id]);
      if (version !== currentVersion) return;
      rows = window.MilaMedia.sorted(map.get(product.id));
      loaded = true;
      status().textContent = "Hasta 5 fotos. La primera es la principal. Los cambios de fotos se guardan al momento.";
    } catch (error) {
      if (version === currentVersion) status().textContent = `No se pudieron cargar las fotos: ${error.message}`;
    } finally {
      if (version === currentVersion) { busy = false; render(); }
    }
  }
  async function apply(data) {
    if (!Array.isArray(data)) throw new Error("Respuesta de galería no válida");
    rows = window.MilaMedia.sorted(data);
    product.image_url = rows[0]?.url || null;
    product.images = rows;
    render();
    await loadAdminProducts();
  }
  async function mutate(action, index = 0, step = 0) {
    if (busy || !product?.id || !loaded) return;
    if ((action === "delete" || action === "clear") &&
      !window.confirm("¿Borrar esta foto del producto? Solo se quitará la referencia.")) return;
    busy = true;
    render();
    document.querySelector("#pf-save").disabled = true;
    try {
      let data;
      if (action === "clear" || (action === "delete" && !rows[index]?.id)) {
        data = await adminRpc("admin_clear_product_main_image", { p_product_id: product.id });
      } else if (action === "delete") {
        data = await adminRpc("admin_delete_product_image", { p_product_id: product.id, p_image_id: rows[index].id });
      } else {
        const order = [...rows];
        if (action === "main") order.unshift(...order.splice(index, 1));
        else [order[index], order[index + step]] = [order[index + step], order[index]];
        data = await adminRpc("admin_reorder_product_images", { p_product_id: product.id, p_image_ids: order.map((image) => image.id) });
      }
      await apply(data);
      status().textContent = "Fotos actualizadas.";
    } catch (error) {
      status().textContent = error.message;
    } finally {
      busy = false;
      render();
      document.querySelector("#pf-save").disabled = false;
    }
  }
  async function uploadSelected() {
    const files = [...document.querySelector("#pf-photo").files];
    if (!files.length || busy || !product?.id || !loaded) return;
    const count = rows.length || (product.image_url ? 1 : 0);
    if (count + files.length > 5) {
      status().textContent = `Máximo 5 fotos. Puedes agregar ${5 - count} más.`;
      document.querySelector("#pf-photo").value = "";
      return;
    }
    busy = true;
    render();
    document.querySelector("#pf-save").disabled = true;
    try {
      for (let index = 0; index < files.length; index++) {
        status().textContent = `Comprimiendo y subiendo foto ${index + 1} de ${files.length}…`;
        const blob = await window.MilaMedia.compress(files[index]);
        const url = await window.MilaMedia.upload(supabaseDashboardClient, product.id, blob);
        await apply(await adminRpc("admin_add_product_image", { p_product_id: product.id, p_url: url }));
      }
      status().textContent = "Fotos guardadas; cada archivo pesa menos de 1 MB.";
    } catch (error) {
      status().textContent = `Se conservaron las fotos ya guardadas. ${error.message}`;
    } finally {
      busy = false;
      render();
      document.querySelector("#pf-photo").value = "";
      document.querySelector("#pf-save").disabled = false;
    }
  }
  function init() {
    document.querySelector("#pf-photo").addEventListener("change", uploadSelected);
    document.querySelector("#pf-photo-clear").addEventListener("click", () => mutate("clear"));
  }
  return { init, open, isBusy: () => busy };
})();
