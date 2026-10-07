// Shared, read-only product galleries and the existing Storage upload mechanism.
window.MilaMedia = (() => {
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const sorted = (rows) => [...(rows || [])].sort((a, b) =>
    Number(a.orden || 0) - Number(b.orden || 0) || String(a.id).localeCompare(String(b.id)));
  const urls = (product) => {
    const gallery = sorted(product.images).map((row) => row.url).filter(Boolean);
    return gallery.length ? gallery : product.image_url ? [product.image_url] : [];
  };
  async function load(client, productIds) {
    if (!productIds.length) return new Map();
    const { data, error } = await client.from("product_images")
      .select("id, product_id, url, orden").in("product_id", productIds).order("orden");
    if (error) throw new Error(error.message);
    const map = new Map();
    (data || []).forEach((image) => {
      if (!map.has(image.product_id)) map.set(image.product_id, []);
      map.get(image.product_id).push(image);
    });
    return map;
  }
  function carousel(product) {
    const photos = urls(product);
    if (!photos.length) return '<div class="product-gallery-empty">Sin foto</div>';
    return `<div class="product-gallery" aria-label="Fotos de ${escape(product.name)}">
      <div class="gallery-track" tabindex="0" aria-label="Desliza para ver las fotos">${photos.map((url, i) =>
        `<img src="${escape(url)}" alt="${escape(product.name)} — foto ${i + 1}" ${i ? 'loading="lazy"' : ""} />`).join("")}</div>
      ${photos.length > 1 ? `<div class="gallery-dots">${photos.map((_, i) =>
        `<button type="button" data-photo-index="${i}" class="gallery-dot ${i ? "" : "is-active"}"
        aria-label="Ver foto ${i + 1}" aria-pressed="${i === 0}"></button>`).join("")}</div>` : ""}
    </div>`;
  }
  function bindCarousel(root) {
    const track = root.querySelector(".gallery-track");
    const dots = [...root.querySelectorAll("[data-photo-index]")];
    if (!track || !dots.length) return;
    const move = (index) => track.scrollTo({ left: index * track.clientWidth, behavior: "smooth" });
    dots.forEach((dot, index) => dot.addEventListener("click", () => move(index)));
    track.addEventListener("scroll", () => {
      const index = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
      dots.forEach((dot, i) => {
        dot.classList.toggle("is-active", i === index);
        dot.setAttribute("aria-pressed", String(i === index));
      });
    }, { passive: true });
    track.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const index = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
      move(Math.max(0, Math.min(dots.length - 1, index + (event.key === "ArrowRight" ? 1 : -1))));
    });
  }
  async function compress(file) {
    const source = URL.createObjectURL(file);
    const image = new Image();
    try {
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error("El archivo no es una imagen válida"));
        image.src = source;
      });
      let size = Math.min(1000, Math.max(image.width, image.height));
      while (size >= 120) {
        const ratio = size / Math.max(image.width, image.height);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * ratio));
        canvas.height = Math.max(1, Math.round(image.height * ratio));
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        for (const quality of [0.82, 0.65, 0.45]) {
          const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
          if (blob && blob.size < 1000000) return blob;
        }
        size = Math.floor(size * 0.7);
      }
      throw new Error("No se pudo comprimir la foto a menos de 1 MB");
    } finally {
      URL.revokeObjectURL(source);
    }
  }
  async function upload(client, productId, blob) {
    if (blob.size >= 1000000) throw new Error("La foto debe pesar menos de 1 MB");
    const filename = `${productId}/${Date.now()}-${crypto.randomUUID()}.jpg`;
    const bucket = client.storage.from("product-images");
    const { error } = await bucket.upload(filename, blob, { contentType: "image/jpeg", upsert: false });
    if (error) throw new Error(`Error exacto de Supabase: ${error.message}${error.statusCode ? ` (${error.statusCode})` : ""}`);
    return bucket.getPublicUrl(filename).data.publicUrl;
  }
  return { escape, sorted, urls, load, carousel, bindCarousel, compress, upload };
})();
