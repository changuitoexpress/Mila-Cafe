// All writes use the new admin PIN RPCs. Hiding never deletes catalog rows.
window.AdminOptions = (() => {
  const $option = (selector) => document.querySelector(selector);
  const escape = (value) => window.MilaMedia.escape(value);
  let groups = [];
  let options = [];
  let optionId = null;
  let assignmentProduct = null;
  let assignmentVersion = 0;
  let selectionVersion = 0;
  let writing = false;
  const feedback = (message) => { $option("#option-editor-feedback").textContent = message; };
  function authFailure() {
    if (!adminPin) {
      $option("#option-editor-modal").classList.add("hidden");
      $option("#product-modal").classList.add("hidden");
    }
  }
  async function readGroups() {
    const { data, error } = await supabaseDashboardClient.from("option_groups")
      .select("id, nombre, obligatorio, max_opciones, orden, activo").order("orden");
    if (error) throw new Error(error.message);
    groups = data || [];
    return groups;
  }
  async function assignments(product) {
    const token = ++assignmentVersion;
    assignmentProduct = product;
    const wrap = $option("#pf-option-groups");
    $option("#pf-options-feedback").textContent = "";
    wrap.innerHTML = "<p>Cargando grupos…</p>";
    if (!product?.id) {
      wrap.innerHTML = "<p>Guarda el producto y vuelve a editarlo para asignar complementos.</p>";
      return;
    }
    try {
      const [catalog, assigned] = await Promise.all([
        readGroups(),
        supabaseDashboardClient.from("product_option_groups").select("group_id, activo").eq("product_id", product.id),
      ]);
      if (token !== assignmentVersion) return;
      if (assigned.error) throw new Error(assigned.error.message);
      const ids = new Set((assigned.data || []).filter((row) => row.activo === true).map((row) => row.group_id));
      wrap.innerHTML = catalog.map((group) => `<label class="check-row option-assignment-row">
        <input type="checkbox" data-assign-group="${group.id}" ${ids.has(group.id) ? "checked" : ""} />
        ${escape(group.nombre)} ${group.activo ? "" : "(grupo oculto)"} ${group.obligatorio ? "· Obligatorio" : ""}
      </label>`).join("") || "<p>No hay grupos. Crea uno con «Editar grupos y opciones».</p>";
      wrap.querySelectorAll("[data-assign-group]").forEach((input) => input.addEventListener("change", async () => {
        const assignedValue = input.checked;
        input.disabled = true;
        try {
          await adminRpc("admin_set_product_option_group", {
            p_product_id: product.id, p_group_id: input.dataset.assignGroup, p_asignado: assignedValue,
          });
          if (token === assignmentVersion) $option("#pf-options-feedback").textContent = "Asignación guardada.";
        } catch (error) {
          input.checked = !assignedValue;
          if (token === assignmentVersion) $option("#pf-options-feedback").textContent = error.message;
          authFailure();
        } finally {
          input.disabled = false;
        }
      }));
    } catch (error) {
      if (token !== assignmentVersion) return;
      wrap.innerHTML = "";
      $option("#pf-options-feedback").textContent = `No se pudieron cargar los complementos: ${error.message}`;
    }
  }
  function fillGroupSelect(selected = "") {
    $option("#og-select").innerHTML = '<option value="">+ Nuevo grupo</option>' +
      groups.map((group) => `<option value="${group.id}">${escape(group.nombre)}${group.activo ? "" : " · Oculto"}</option>`).join("");
    $option("#og-select").value = selected;
  }
  function fillOption(option = null) {
    optionId = option?.id || null;
    $option("#op-name").value = option?.nombre || "";
    $option("#op-price").value = option?.precio_extra ?? 0;
    $option("#op-order").value = option?.orden ?? 0;
    $option("#op-active").checked = option ? option.activo === true : true;
    $option("#op-save").textContent = option ? "Guardar cambios de opción" : "Agregar opción";
    $option("#op-save").disabled = !$option("#og-select").value;
  }
  async function selectGroup() {
    const token = ++selectionVersion;
    const id = $option("#og-select").value;
    const group = groups.find((row) => row.id === id);
    $option("#og-name").value = group?.nombre || "";
    $option("#og-max").value = group?.max_opciones ?? 1;
    $option("#og-order").value = group?.orden ?? 0;
    $option("#og-required").checked = group?.obligatorio === true;
    $option("#og-active").checked = group ? group.activo === true : true;
    options = [];
    fillOption();
    $option("#group-options-list").innerHTML = id ? "<p>Cargando opciones…</p>" : "<p>Guarda el nuevo grupo antes de agregar opciones.</p>";
    if (!id) return;
    try {
      const { data, error } = await supabaseDashboardClient.from("options")
        .select("id, group_id, nombre, precio_extra, orden, activo").eq("group_id", id).order("orden");
      if (token !== selectionVersion) return;
      if (error) throw new Error(error.message);
      options = data || [];
      $option("#group-options-list").innerHTML = options.map((option) => `<div class="group-option-row">
        <div><strong>${escape(option.nombre)}</strong><br />+MXN ${Number(option.precio_extra || 0).toFixed(2)} · ${option.activo ? "Activa" : "Oculta"}</div>
        <button type="button" class="btn btn-secondary" data-edit-option="${option.id}">Editar</button>
      </div>`).join("") || "<p>Este grupo todavía no tiene opciones.</p>";
      $option("#group-options-list").querySelectorAll("[data-edit-option]").forEach((button) =>
        button.addEventListener("click", () => {
          if (writing) return;
          fillOption(options.find((row) => row.id === button.dataset.editOption));
          $option("#op-name").focus();
        }));
    } catch (error) {
      if (token === selectionVersion) {
        $option("#group-options-list").innerHTML = "";
        feedback(error.message);
      }
    }
  }
  async function openEditor() {
    if (writing) return;
    lock(true);
    $option("#option-editor-modal").classList.remove("hidden");
    feedback("Cargando grupos…");
    try {
      await readGroups();
      fillGroupSelect();
      await selectGroup();
      feedback("");
      $option("#og-name").focus();
    } catch (error) { feedback(error.message); }
    finally { lock(false); }
  }
  function lock(value) {
    writing = value;
    $option("#og-select").disabled = value;
    $option("#option-editor-modal").querySelectorAll("button").forEach((button) => { button.disabled = value; });
    if (!value) $option("#op-save").disabled = !$option("#og-select").value;
  }
  async function saveGroup(event) {
    event.preventDefault();
    if (writing) return;
    lock(true);
    feedback("Guardando grupo…");
    try {
      const row = await adminRpc("admin_save_option_group", {
        p_id: $option("#og-select").value || null,
        p_nombre: $option("#og-name").value.trim(), p_obligatorio: $option("#og-required").checked,
        p_max_opciones: Number($option("#og-max").value), p_orden: Number($option("#og-order").value) || 0,
        p_activo: $option("#og-active").checked,
      });
      if (!row?.id) throw new Error("La función no devolvió el grupo guardado");
      await readGroups();
      fillGroupSelect(row.id);
      await selectGroup();
      feedback("Grupo guardado. Desmarca Activo para ocultarlo sin borrar sus opciones.");
      if (!$option("#product-modal").classList.contains("hidden")) await assignments(assignmentProduct);
    } catch (error) { feedback(error.message); authFailure(); }
    finally { lock(false); }
  }
  async function saveOption(event) {
    event.preventDefault();
    if (writing) return;
    const groupId = $option("#og-select").value;
    if (!groupId) { feedback("Guarda primero el grupo."); return; }
    lock(true);
    feedback("Guardando opción…");
    try {
      await adminRpc("admin_save_option", {
        p_id: optionId, p_group_id: groupId, p_nombre: $option("#op-name").value.trim(),
        p_precio_extra: Number($option("#op-price").value), p_orden: Number($option("#op-order").value) || 0,
        p_activo: $option("#op-active").checked,
      });
      await selectGroup();
      feedback("Opción guardada. Las opciones ocultas permanecen en el catálogo.");
    } catch (error) { feedback(error.message); authFailure(); }
    finally { lock(false); }
  }
  function init() {
    $option("#option-editor-open").addEventListener("click", openEditor);
    $option("#pf-manage-groups").addEventListener("click", openEditor);
    $option("#option-editor-close").addEventListener("click", () => {
      if (!writing) $option("#option-editor-modal").classList.add("hidden");
    });
    $option("#og-select").addEventListener("change", () => { if (!writing) { feedback(""); selectGroup(); } });
    $option("#op-new").addEventListener("click", () => { if (!writing) { fillOption(); $option("#op-name").focus(); } });
    $option("#option-group-form").addEventListener("submit", saveGroup);
    $option("#option-form").addEventListener("submit", saveOption);
  }
  return { init, assignments };
})();
