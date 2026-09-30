const installBanner = document.getElementById("install-banner");
const installAction = document.getElementById("install-action");
const installMessage = document.getElementById("install-message");
let pendingInstallEvent = null;

function hideInstallBanner() {
  installBanner.classList.add("hidden");
}

document.getElementById("install-dismiss").addEventListener("click", () => {
  try { sessionStorage.setItem("milaInstallDismissed", "1"); } catch {}
  hideInstallBanner();
});

function showInstallBanner(message, showAction = false) {
  try {
    if (sessionStorage.getItem("milaInstallDismissed") === "1") return;
  } catch {}
  if (window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone) return;
  installMessage.textContent = message;
  installAction.classList.toggle("hidden", !showAction);
  installBanner.classList.remove("hidden");
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  pendingInstallEvent = event;
  showInstallBanner("Instálala para abrir el menú desde tu pantalla de inicio.", true);
});

installAction.addEventListener("click", async () => {
  if (!pendingInstallEvent) return;
  const event = pendingInstallEvent;
  pendingInstallEvent = null;
  hideInstallBanner();
  await event.prompt();
  await event.userChoice;
});

window.addEventListener("appinstalled", () => {
  pendingInstallEvent = null;
  hideInstallBanner();
});

const isAppleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent)
  || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isSafari = /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);
if (isAppleMobile && isSafari) {
  showInstallBanner("En Safari, toca Compartir y después «Agregar a pantalla de inicio».");
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch((error) => {
      console.warn("No se pudo registrar la app instalable:", error);
    });
  });
}