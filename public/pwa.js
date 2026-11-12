// "Add to home screen" — registers the service worker and offers to install the app.
//   window.tlPwa.canInstall()  true when the browser can show its install prompt (Android/desktop Chrome)
//   window.tlPwa.isIOS         iPhone/iPad Safari: install is done from the Share menu
//   window.tlPwa.install()     shows the install prompt (or iPhone instructions)
// Pages with <body data-install-banner> also get a small, dismissible install banner.
(function () {
  const DISMISS_KEY = "tl:installDismissedAt";
  const SNOOZE_DAYS = 14;
  let deferred = null;

  const isStandalone = () =>
    window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("Service worker:", err.message));
    });
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e;
    document.dispatchEvent(new Event("tl:installable"));
    maybeShowBanner();
  });

  window.addEventListener("appinstalled", () => {
    deferred = null;
    hideBanner();
    document.dispatchEvent(new Event("tl:installed"));
  });

  async function install() {
    if (deferred) {
      deferred.prompt();
      const choice = await deferred.userChoice.catch(() => null);
      deferred = null;
      hideBanner();
      return choice && choice.outcome === "accepted";
    }
    if (isIOS) {
      showIOSHelp();
      return false;
    }
    alert("To install Taste Lounge, open your browser menu and choose “Install app” or “Add to Home screen”.");
    return false;
  }

  window.tlPwa = {
    canInstall: () => !!deferred,
    isIOS,
    isStandalone,
    install,
  };

  /* ---------------- banner ---------------- */
  function snoozed() {
    try {
      const at = Number(localStorage.getItem(DISMISS_KEY));
      return at && Date.now() - at < SNOOZE_DAYS * 864e5;
    } catch (e) {
      return false;
    }
  }

  function injectStyles() {
    if (document.getElementById("tl-pwa-style")) return;
    const style = document.createElement("style");
    style.id = "tl-pwa-style";
    style.textContent = `
      .tl-install{position:fixed;left:12px;right:12px;bottom:84px;z-index:10040;max-width:460px;margin:0 auto;
        display:flex;align-items:center;gap:12px;padding:12px 12px 12px 14px;border-radius:16px;background:#1A1A1A;color:#fff;
        box-shadow:0 12px 30px rgba(0,0,0,.3);font-family:Poppins,system-ui,sans-serif;animation:tlInstallIn .35s ease}
      @media (min-width:901px){.tl-install{bottom:24px}}
      .tl-install img{width:44px;height:44px;border-radius:12px;background:#fff;flex:none}
      .tl-install p{margin:0;flex:1;font-size:.86rem;line-height:1.35}
      .tl-install b{display:block;font-size:.95rem}
      .tl-install button{border:0;cursor:pointer;font:600 .85rem Poppins,system-ui,sans-serif}
      .tl-install .tl-install-go{background:#ff0000;color:#fff;border-radius:999px;padding:10px 16px}
      .tl-install .tl-install-x{background:transparent;color:#bbb;font-size:1.3rem;padding:4px 6px;line-height:1}
      .tl-install button:focus-visible{outline:3px solid #FBC02D;outline-offset:2px}
      .tl-ios-help{position:fixed;inset:0;z-index:10055;background:rgba(0,0,0,.55);display:flex;align-items:flex-end;justify-content:center}
      .tl-ios-help div{background:#fff;color:#1A1A1A;width:100%;max-width:480px;border-radius:20px 20px 0 0;padding:24px 22px 30px;
        font-family:Poppins,system-ui,sans-serif;animation:tlInstallIn .3s ease}
      .tl-ios-help h3{margin:0 0 12px;font-size:1.15rem}
      .tl-ios-help ol{margin:0 0 18px;padding-left:20px;line-height:1.8}
      .tl-ios-help button{width:100%;border:0;border-radius:999px;padding:13px;background:#ff0000;color:#fff;font:600 1rem Poppins,system-ui,sans-serif}
      @keyframes tlInstallIn{from{transform:translateY(20px);opacity:0}to{transform:none;opacity:1}}`;
    document.head.appendChild(style);
  }

  function maybeShowBanner() {
    if (!document.body || !document.body.hasAttribute("data-install-banner")) return;
    if (isStandalone() || snoozed() || document.querySelector(".tl-install")) return;
    if (!deferred && !isIOS) return;
    injectStyles();
    const bar = document.createElement("div");
    bar.className = "tl-install";
    bar.setAttribute("role", "dialog");
    bar.setAttribute("aria-label", "Install the Taste Lounge app");
    bar.innerHTML = `
      <img src="icons/icon-192.png" alt="">
      <p><b>Get the Taste Lounge app</b>Order faster, right from your home screen.</p>
      <button type="button" class="tl-install-go">Install</button>
      <button type="button" class="tl-install-x" aria-label="Not now">×</button>`;
    bar.querySelector(".tl-install-go").onclick = install;
    bar.querySelector(".tl-install-x").onclick = () => {
      try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch (e) { }
      hideBanner();
    };
    document.body.appendChild(bar);
  }

  function hideBanner() {
    const bar = document.querySelector(".tl-install");
    if (bar) bar.remove();
  }

  function showIOSHelp() {
    injectStyles();
    const wrap = document.createElement("div");
    wrap.className = "tl-ios-help";
    wrap.innerHTML = `
      <div role="dialog" aria-label="Install on iPhone">
        <h3>Add Taste Lounge to your Home Screen</h3>
        <ol>
          <li>Tap the <b>Share</b> button <span aria-hidden="true">⬆️</span> at the bottom of Safari</li>
          <li>Scroll down and tap <b>Add to Home Screen</b></li>
          <li>Tap <b>Add</b></li>
        </ol>
        <button type="button">Got it</button>
      </div>`;
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap || e.target.tagName === "BUTTON") wrap.remove();
    });
    document.body.appendChild(wrap);
  }

  // iPhone never fires beforeinstallprompt — offer the instructions after a moment
  if (isIOS) window.addEventListener("load", () => setTimeout(maybeShowBanner, 2500));
})();
