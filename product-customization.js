// Catalog reads and immutable per-line snapshots. No catalog writes from clients.
window.MilaOptions = (() => {
  const money = (value) => Number(value || 0).toFixed(2);
  const escape = (value) => window.MilaMedia.escape(value);
  const list = (value) => Array.isArray(value) ? value : [];
  const allergies = (value) => Array.isArray(value) ? value.filter(Boolean).map(String)
    : typeof value === "string" && value.trim() ? [value.trim()] : [];
  async function load(client, productIds) {
    const result = new Map();
    if (!productIds.length) return result;
    const { data: assignments, error: assignmentError } = await client.from("product_option_groups")
      .select("product_id, group_id, activo").in("product_id", productIds).eq("activo", true);
    if (assignmentError) throw new Error(assignmentError.message);
    const activeAssignments = (assignments || []).filter((row) => row.activo === true);
    const groupIds = [...new Set(activeAssignments.map((row) => row.group_id))];
    if (!groupIds.length) return result;
    const { data: groups, error: groupError } = await client.from("option_groups")
      .select("id, nombre, obligatorio, max_opciones, orden, activo").in("id", groupIds)
      .eq("activo", true).order("orden");
    if (groupError) throw new Error(groupError.message);
    const activeGroups = (groups || []).filter((row) => row.activo === true);
    if (!activeGroups.length) return result;
    const { data: options, error: optionError } = await client.from("options")
      .select("id, group_id, nombre, precio_extra, orden, activo").in("group_id", activeGroups.map((row) => row.id))
      .eq("activo", true).order("orden");
    if (optionError) throw new Error(optionError.message);
    const groupMap = new Map(activeGroups.map((group) => [group.id, {
      ...group, options: (options || []).filter((option) => option.activo === true && option.group_id === group.id),
    }]));
    activeAssignments.forEach((assignment) => {
      if (!groupMap.has(assignment.group_id)) return;
      if (!result.has(assignment.product_id)) result.set(assignment.product_id, []);
      const assignedGroups = result.get(assignment.product_id);
      if (!assignedGroups.some((group) => group.id === assignment.group_id)) {
        assignedGroups.push(groupMap.get(assignment.group_id));
      }
    });
    result.forEach((rows) => rows.sort((a, b) => Number(a.orden || 0) - Number(b.orden || 0)));
    return result;
  }
  function snapshot(groups, selectedIds) {
    return groups.flatMap((group) => group.options.filter((option) => selectedIds.has(option.id)).map((option) => ({
      group_id: group.id, grupo: group.nombre, option_id: option.id,
      nombre: option.nombre, precio_extra: Number(option.precio_extra || 0),
    })));
  }
  function validate(groups, selected) {
    const errors = [];
    const choices = list(selected);
    groups.forEach((group) => {
      const count = choices.filter((option) => option.group_id === group.id).length;
      if (group.obligatorio && !count) errors.push({ id: group.id, message: "Selecciona al menos una opción para continuar." });
      if (count > Number(group.max_opciones)) errors.push({ id: group.id, message: `Puedes elegir hasta ${group.max_opciones} opción(es).` });
    });
    choices.forEach((choice) => {
      const group = groups.find((row) => row.id === choice.group_id);
      if (!group?.options.some((option) => option.id === choice.option_id)) {
        errors.push({ id: choice.group_id, message: "Esta opción ya no está disponible. Vuelve a abrir el producto." });
      }
    });
    return errors;
  }
  function unitPrice(line) {
    if (line.unitPrice != null) return Number(line.unitPrice);
    return Number((Number(line.product?.price || 0) +
      list(line.opciones).reduce((sum, option) => sum + Number(option.precio_extra || 0), 0)).toFixed(2));
  }
  function signature(line) {
    const choices = list(line.opciones).map((option) => [option.group_id, option.option_id, Number(option.precio_extra || 0)])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return JSON.stringify([line.product.id, unitPrice(line), choices, String(line.notas || "").trim(), [...allergies(line.alergias)].sort()]);
  }
  function makeLine(product, qty, custom = {}) {
    if (!Number.isInteger(qty) || qty < 1) throw new Error("La cantidad debe ser mayor que cero");
    const line = { product, qty, opciones: list(custom.opciones).map((option) => ({ ...option })),
      notas: String(custom.notas || "").trim(), alergias: [...new Set(allergies(custom.alergias))] };
    line.unitPrice = unitPrice(line);
    return line;
  }
  function detailHtml(line) {
    return `<div class="line-details">${list(line.opciones).map((option) =>
      `<div>${escape(option.grupo || "Complemento")}: ${escape(option.nombre)} <span>+MXN ${money(option.precio_extra)}</span></div>`).join("")}
      ${line.notas ? `<p><strong>Nota:</strong> ${escape(line.notas)}</p>` : ""}
      ${allergies(line.alergias).length ? `<p class="allergy-alert"><strong>Alergias:</strong> ${escape(allergies(line.alergias).join(", "))}</p>` : ""}
    </div>`;
  }
  function whatsappDetails(line) {
    const text = list(line.opciones).map((option) => `  ${option.grupo || "Complemento"}: ${option.nombre} (+MXN ${money(option.precio_extra)})`);
    if (line.notas) text.push(`  Instrucciones: ${line.notas}`);
    if (allergies(line.alergias).length) text.push(`  ALERGIAS: ${allergies(line.alergias).join(", ")}`);
    return text;
  }
  return { load, snapshot, validate, unitPrice, signature, makeLine, detailHtml, whatsappDetails, allergies };
})();
