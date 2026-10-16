window.MilaProductSheet = (() => {
  let version = 0;
  const $sheet = (selector) => document.querySelector(selector);
  const escape = (value) => window.MilaMedia.escape(value);
  const price = (value) => Number(value || 0).toFixed(2);
  // The CTA bar keeps the same layout while loading so nothing jumps when options arrive.
  const footerMarkup = (disabled) => `
        <div class="sheet-quantity" aria-label="Cantidad">
          <button id="sheet-minus" type="button" aria-label="Reducir cantidad" disabled>−</button>
          <span id="sheet-qty" aria-live="polite">1</span>
          <button id="sheet-plus" type="button" aria-label="Aumentar cantidad"${disabled ? " disabled" : ""}>+</button>
        </div>
        <button id="sheet-add" type="button" class="sheet-add"${disabled ? " disabled" : ""}></button>`;
  // Photo and heading render immediately; only #sheet-options is filled once the options load.
  function shell(product) {
    return `${window.MilaMedia.carousel(product)}
      <div class="sheet-heading"><p class="eyebrow">${escape(product.category || "Café")}</p>
        <h2 id="sheet-product-title">${escape(product.name)}</h2><strong class="sheet-price">MXN ${price(product.price)}</strong>
        ${product.description ? `<p class="sheet-description">${escape(product.description)}</p>` : ""}
      </div>
      <div id="sheet-options" class="sheet-options" aria-busy="true">
        <div class="sheet-skeleton" aria-hidden="true"><span class="skeleton-line skeleton-title"></span>
          <span class="skeleton-line"></span><span class="skeleton-line"></span><span class="skeleton-line"></span></div>
        <p class="sheet-loading" role="status">Cargando complementos…</p>
      </div>`;
  }
  async function open(product, client, onAdd, onClose) {
    const token = ++version;
    const body = $sheet("#modal-product-body");
    const footer = $sheet("#product-sheet-footer");
    body.innerHTML = shell(product);
    body.scrollTop = 0;
    window.MilaMedia.bindCarousel(body);
    footer.innerHTML = footerMarkup(true);
    footer.classList.remove("hidden");
    $sheet("#sheet-add").textContent = `Agregar 1 al carrito · MXN ${price(product.price)}`;
    document.body.classList.add("product-sheet-open");
    const modal = $sheet("#modal-product");
    modal.onkeydown = (event) => {
      if (event.key === "Escape") { onClose(); return; }
      if (event.key !== "Tab") return;
      const controls = [...modal.querySelectorAll("button:not(:disabled), input:not(:disabled), textarea, [tabindex='0']")]
        .filter((control) => !control.closest(".hidden"));
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    $sheet("#modal-product-close").focus();
    try {
      const map = await window.MilaOptions.load(client, [product.id]);
      if (token !== version || modal.classList.contains("hidden")) return;
      const groups = map.get(product.id) || [];
      product.optionGroups = groups;
      render(product, groups, onAdd);
      if (!modal.contains(document.activeElement)) $sheet("#modal-product-close").focus();
    } catch (error) {
      if (token !== version || modal.classList.contains("hidden")) return;
      const options = $sheet("#sheet-options");
      options.setAttribute("aria-busy", "false");
      options.innerHTML = `<p class="sheet-feedback" role="alert">No se pudieron cargar los complementos: ${escape(error.message)}</p>
        <button id="sheet-retry" class="btn btn-secondary" type="button">Reintentar</button>`;
      $sheet("#sheet-retry").addEventListener("click", () => open(product, client, onAdd, onClose));
    }
  }
  function render(product, groups, onAdd) {
    const body = $sheet("#modal-product-body");
    const options = $sheet("#sheet-options");
    let quantity = 1;
    options.innerHTML = `
      ${groups.map((group) => `<fieldset class="sheet-section option-group" data-group-id="${group.id}">
        <legend class="group-heading">${escape(group.nombre)}
          ${group.obligatorio ? '<span class="required-tag">Obligatorio</span>' : ""}</legend>
        <p class="group-hint">${Number(group.max_opciones) === 1 ? "Elegir 1" : `Elegir hasta ${Number(group.max_opciones)}`}</p>
        ${!group.obligatorio && Number(group.max_opciones) === 1 ? `<label class="choice-row">
          <input type="radio" name="group-${group.id}" data-option-none checked value="" />
          <span class="choice-name">Sin complemento</span><span class="choice-price">MXN 0.00</span>
        </label>` : ""}
        ${group.options.map((option) => `<label class="choice-row">
          <input type="${Number(group.max_opciones) === 1 ? "radio" : "checkbox"}" name="group-${group.id}"
            data-option-id="${option.id}" data-group-id="${group.id}" value="${option.id}" />
          <span class="choice-name">${escape(option.nombre)}</span><span class="choice-price">+MXN ${Number(option.precio_extra || 0).toFixed(2)}</span>
        </label>`).join("") || '<p>No hay opciones disponibles para este grupo.</p>'}
        <p class="group-error" role="alert"></p>
      </fieldset>`).join("")}
      <section class="sheet-section">
        <label class="group-heading" for="sheet-instructions">Instrucciones especiales</label>
        <textarea id="sheet-instructions" class="input" rows="3" placeholder="Escribe cómo prefieres este producto"></textarea>
        <p class="group-hint">Solo para este pedido; no modifica el menú.</p>
      </section>
      <section class="sheet-section">
        <h3 class="group-heading">Solicitudes por alergia</h3>
        <div class="allergy-choices">${["Sin gluten", "Sin lácteos", "Sin frutos secos", "Otra"].map((allergy) =>
          `<label class="choice-row"><input type="checkbox" data-allergy value="${allergy}" /><span class="choice-name">${allergy}</span></label>`).join("")}</div>
        <label id="sheet-allergy-extra-wrap" class="allergy-extra hidden" for="sheet-allergy-extra">Describe la otra alergia
          <textarea id="sheet-allergy-extra" class="input" rows="2"></textarea></label>
        <p id="sheet-allergy-error" class="group-error" role="alert"></p>
      </section>
      <p id="sheet-feedback" class="sheet-feedback" role="alert"></p>`;
    options.setAttribute("aria-busy", "false");
    options.classList.add("is-ready");
    const footer = $sheet("#product-sheet-footer");
    footer.classList.remove("hidden");
    footer.innerHTML = footerMarkup(false);
    const selection = () => window.MilaOptions.snapshot(groups, new Set([...body.querySelectorAll("[data-option-id]:checked")].map((input) => input.value)));
    function update() {
      const chosen = selection();
      const price = Number(product.price) + chosen.reduce((sum, option) => sum + option.precio_extra, 0);
      $sheet("#sheet-qty").textContent = quantity;
      $sheet("#sheet-minus").disabled = quantity === 1;
      $sheet("#sheet-add").textContent = `Agregar ${quantity} al carrito · MXN ${(Number(price.toFixed(2)) * quantity).toFixed(2)}`;
      groups.forEach((group) => {
        const selectedCount = chosen.filter((option) => option.group_id === group.id).length;
        body.querySelectorAll(`input[type="checkbox"][data-group-id="${group.id}"]`).forEach((input) => {
          input.disabled = !input.checked && selectedCount >= Number(group.max_opciones);
        });
        if (!group.obligatorio || selectedCount) {
          const section = body.querySelector(`fieldset[data-group-id="${group.id}"]`);
          section.classList.remove("is-invalid");
          section.removeAttribute("aria-invalid");
          section.querySelector(".group-error").textContent = "";
        }
      });
    }
    body.querySelectorAll("[data-option-id], [data-option-none]").forEach((input) => input.addEventListener("change", update));
    body.querySelectorAll("[data-allergy]").forEach((input) => input.addEventListener("change", () => {
      const other = body.querySelector('[data-allergy][value="Otra"]').checked;
      $sheet("#sheet-allergy-extra-wrap").classList.toggle("hidden", !other);
      if (other && input.value === "Otra") $sheet("#sheet-allergy-extra").focus();
      if (!other) $sheet("#sheet-allergy-error").textContent = "";
    }));
    $sheet("#sheet-minus").addEventListener("click", () => {
      quantity = Math.max(1, quantity - 1);
      update();
      window.MilaMotion?.pulse?.($sheet("#sheet-qty"));
    });
    $sheet("#sheet-plus").addEventListener("click", () => {
      quantity++;
      update();
      window.MilaMotion?.pulse?.($sheet("#sheet-qty"));
    });
    $sheet("#sheet-add").addEventListener("click", () => {
      const chosen = selection();
      const errors = window.MilaOptions.validate(groups, chosen);
      errors.forEach((error) => {
        const section = body.querySelector(`fieldset[data-group-id="${error.id}"]`);
        section.classList.add("is-invalid");
        section.setAttribute("aria-invalid", "true");
        section.querySelector(".group-error").textContent = error.message;
      });
      if (errors.length) {
        const first = body.querySelector(`fieldset[data-group-id="${errors[0].id}"]`);
        first.scrollIntoView({ behavior: "smooth", block: "center" });
        first.querySelector("input")?.focus();
        return;
      }
      const requestedAllergies = [...body.querySelectorAll("[data-allergy]:checked")].map((input) => input.value);
      if (requestedAllergies.includes("Otra") && !$sheet("#sheet-allergy-extra").value.trim()) {
        $sheet("#sheet-allergy-error").textContent = "Describe la otra alergia para continuar.";
        $sheet("#sheet-allergy-extra").focus();
        return;
      }
      const line = window.MilaOptions.makeLine(product, quantity, {
        opciones: chosen, notas: $sheet("#sheet-instructions").value,
        alergias: requestedAllergies.map((allergy) => allergy === "Otra" ? `Otra: ${$sheet("#sheet-allergy-extra").value.trim()}` : allergy),
      });
      try { onAdd(line); } catch (error) { $sheet("#sheet-feedback").textContent = error.message; }
    });
    update();
  }
  return { open };
})();
