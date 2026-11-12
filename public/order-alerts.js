/* Order updates for customers. When the kitchen moves one of your orders along
 * (Admin → Orders), e.g. "Ready for pickup" or "Out for delivery", this shows a
 * message, plays a sound, buzzes the phone and, if notifications are allowed,
 * puts a notification on the phone.
 *
 * Works while Taste Lounge is open in the browser or the installed app, including
 * in the background. (Waking a fully closed app needs a push server, which the
 * free Firebase plan doesn't include.)
 *
 * Needs order-status.js. Load with `defer` so the page's Firebase setup runs first.
 *   tlOrderAlerts.renderPrompt(el)   shows "Turn on order notifications" in el when useful
 */
(function () {
  const SEEN_KEY = "tl:orderStatusSeen";
  let memory = null; // statuses this tab has already seen
  const FRESH_MS = 3 * 60 * 60 * 1000; // a change older than this isn't news (app not opened for a while)
  const supported = "Notification" in window;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = () => window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  let activeOrders = 0;
  const prompts = new Set();

  const readSeen = () => {
    try { return JSON.parse(localStorage.getItem(SEEN_KEY)) || {}; } catch (e) { return {}; }
  };
  const writeSeen = (seen) => {
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch (e) { }
  };
  const changedAt = (o) => {
    const st = tlStatusOf(o);
    const t = (o.status && o.status.times && o.status.times[st]) || o.updatedAt || o.createdAt;
    return t && t.toMillis ? t.toMillis() : Date.now();
  };

  function styles() {
    if (document.getElementById("tl-oa-style")) return;
    const style = document.createElement("style");
    style.id = "tl-oa-style";
    style.textContent = `
      .tl-oa{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:10070;width:min(440px,calc(100vw - 24px));
        display:flex;flex-direction:column;gap:10px;pointer-events:none}
      .tl-oa-card{pointer-events:auto;display:flex;align-items:center;gap:10px;padding:14px 12px 14px 16px;border-radius:16px;
        background:#1A1A1A;color:#fff;box-shadow:0 14px 34px rgba(0,0,0,.3);font-family:Inter,Poppins,system-ui,sans-serif;
        border-left:6px solid #FBC02D;animation:tlOaIn .35s ease}
      .tl-oa-card.is-big{border-left-color:#ff0000}
      .tl-oa-text{flex:1;min-width:0}
      .tl-oa-text b{display:block;font-size:15px;margin-bottom:2px;color:#fff}
      .tl-oa-text span{display:block;font-size:13px;line-height:1.4;color:#ddd}
      .tl-oa-go{flex:none;background:#ff0000;color:#fff!important;text-decoration:none;font:600 13px Inter,system-ui,sans-serif;
        border-radius:999px;padding:9px 14px}
      .tl-oa-x{flex:none;border:0;background:none;color:#aaa;font-size:22px;line-height:1;cursor:pointer;padding:4px}
      .tl-oa-go:focus-visible,.tl-oa-x:focus-visible,.tl-np button:focus-visible{outline:3px solid #FBC02D;outline-offset:2px}
      @keyframes tlOaIn{from{transform:translateY(-16px);opacity:0}to{transform:none;opacity:1}}
      .tl-np{display:flex;align-items:center;gap:12px;padding:14px 16px;margin:0 0 16px;border-radius:14px;background:#fff;
        border:1.5px solid #FBC02D;box-shadow:0 4px 12px rgba(0,0,0,.06);font-family:Inter,Poppins,system-ui,sans-serif;color:#1A1A1A}
      .tl-np.is-on{border-color:#a5d6a7;background:#f1f8f1}
      .tl-np.is-off{border-color:#e0e0e0;background:#fafafa}
      .tl-np-ico{flex:none;font-size:24px}
      .tl-np div{flex:1;min-width:0}
      .tl-np b{display:block;font-size:15px}
      .tl-np span{display:block;font-size:13px;line-height:1.4;color:#555}
      .tl-np button{flex:none;border:0;border-radius:999px;padding:10px 16px;background:#ff0000;color:#fff;
        font:600 14px Inter,system-ui,sans-serif;cursor:pointer}
      body.dark .tl-np{background:#1e1e1e!important;border-color:#444}
      body.dark .tl-np b{color:#fff!important}
      body.dark .tl-np span{color:#bbb!important}
      body.dark .tl-np button{color:#fff!important}`;
    document.head.appendChild(style);
  }

  /* ---------------- the alert itself ---------------- */
  let box = null;
  function banner(alert, url) {
    styles();
    if (!box || !box.isConnected) {
      box = document.createElement("div");
      box.className = "tl-oa";
      box.setAttribute("aria-live", "assertive");
      document.body.appendChild(box);
    }
    const card = document.createElement("div");
    card.className = "tl-oa-card" + (alert.important ? " is-big" : "");
    card.setAttribute("role", "alert");
    card.innerHTML = `<div class="tl-oa-text"><b></b><span></span></div>
      ${url ? '<a class="tl-oa-go">View</a>' : ""}<button type="button" class="tl-oa-x" aria-label="Dismiss">×</button>`;
    card.querySelector("b").textContent = alert.title;
    card.querySelector("span").textContent = alert.body;
    if (url) card.querySelector("a").href = url;
    card.querySelector("button").onclick = () => card.remove();
    box.prepend(card);
    while (box.children.length > 3) box.lastChild.remove();
    setTimeout(() => card.remove(), alert.important ? 30000 : 12000);
  }

  function buzz(important) {
    try {
      if (navigator.vibrate) navigator.vibrate(important ? [400, 150, 400, 150, 600] : [250, 100, 250]);
    } catch (e) { }
    try {
      new Audio("sounds-processing.mp3").play().catch(() => { });
    } catch (e) { }
  }

  // One notification per order and status: if the app is open in two tabs, the
  // second one has the same tag and quietly replaces the first instead of buzzing
  // again. Older updates for the same order are cleared from the phone.
  async function systemNotify(alert, url, group, status) {
    if (!supported || Notification.permission !== "granted") return;
    const tag = group + ":" + status;
    const options = {
      body: alert.body,
      icon: "icons/icon-192.png",
      tag,
      vibrate: alert.important ? [400, 150, 400, 150, 600] : [250, 100, 250],
      data: { url },
    };
    try {
      const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
      if (reg) {
        (await reg.getNotifications()).forEach((n) => n.tag.startsWith(group + ":") && n.tag !== tag && n.close());
        return await reg.showNotification(alert.title, options);
      }
    } catch (e) { }
    try {
      const n = new Notification(alert.title, options); // desktop browsers without the service worker
      n.onclick = () => { window.focus(); location.href = url; };
    } catch (e) { }
  }

  function notify(id, o) {
    const alert = tlStatusAlert(o, id);
    if (!alert) return;
    const url = "order-details.html?id=" + encodeURIComponent(id);
    banner(alert, url); // every open tab shows it
    if (document.visibilityState === "visible") buzz(alert.important); // only the tab you're looking at
    systemNotify(alert, url, "order-" + id, tlStatusOf(o));
    document.dispatchEvent(new CustomEvent("tl:order-status", { detail: { id, order: o, status: tlStatusOf(o) } }));
  }

  /* ---------------- watch the customer's latest orders ---------------- */
  function watch(db, uid) {
    // includeMetadataChanges: when the page already watches these orders, the first
    // snapshot comes from memory and the server's confirmation arrives as a
    // metadata-only change, which we'd otherwise never hear about.
    return db.collection("orders").where("userId", "==", uid).orderBy("createdAt", "desc").limit(10)
      .onSnapshot({ includeMetadataChanges: true }, (snap) => {
        activeOrders = snap.docs.filter((d) => !["delivered", "cancelled"].includes(tlStatusOf(d.data()))).length;
        prompts.forEach(paint);
        if (snap.metadata.fromCache) return; // only alert on what the server says
        // this tab compares with what it last saw; the stored copy covers app restarts
        if (!memory) memory = readSeen();
        const next = {};
        snap.docs.forEach((d) => {
          const o = d.data();
          const st = tlStatusOf(o);
          next[d.id] = st;
          if (memory[d.id] && memory[d.id] !== st && Date.now() - changedAt(o) < FRESH_MS) notify(d.id, o);
          memory[d.id] = st;
        });
        writeSeen(next);
      }, (err) => console.warn("Order updates unavailable:", err.message));
  }

  /* ---------------- "turn on notifications" card ---------------- */
  function paint(el) {
    if (!el.isConnected) return prompts.delete(el);
    let html = "";
    if (activeOrders > 0) {
      if (supported && Notification.permission === "default") {
        html = `<div class="tl-np"><span class="tl-np-ico" aria-hidden="true">🔔</span>
          <div><b>Get notified about your order</b><span>We'll buzz your phone when it's ready for pickup or on its way.</span></div>
          <button type="button" data-np-on>Turn on</button></div>`;
      } else if (supported && Notification.permission === "granted") {
        html = `<div class="tl-np is-on"><span class="tl-np-ico" aria-hidden="true">🔔</span>
          <div><b>Notifications are on</b><span>Keep Taste Lounge open (it can stay in the background) and we'll buzz your phone as your order moves along.</span></div></div>`;
      } else if (supported) {
        html = `<div class="tl-np is-off"><span class="tl-np-ico" aria-hidden="true">🔕</span>
          <div><b>Notifications are blocked</b><span>Allow notifications for this site in your browser settings to get order updates. You'll still see updates here.</span></div></div>`;
      } else if (isIOS && !standalone()) {
        html = `<div class="tl-np"><span class="tl-np-ico" aria-hidden="true">🔔</span>
          <div><b>Want order notifications?</b><span>On iPhone, add Taste Lounge to your Home Screen first, then open it from there.</span></div>
          ${window.tlPwa ? '<button type="button" data-np-install>Show me</button>' : ""}</div>`;
      }
    }
    styles();
    el.innerHTML = html;
    el.hidden = !html;
  }

  document.addEventListener("click", async (e) => {
    if (e.target.closest("[data-np-install]")) return window.tlPwa && window.tlPwa.install();
    if (!e.target.closest("[data-np-on]")) return;
    const result = await Notification.requestPermission().catch(() => "default");
    prompts.forEach(paint);
    if (result === "granted") {
      const alert = { title: "🔔 Notifications are on", body: "We'll let you know when your order moves along.", important: false };
      systemNotify(alert, "orders.html", "tl-notify", "on");
      buzz(false);
    }
  });

  window.tlOrderAlerts = {
    renderPrompt(el) {
      if (!el) return;
      prompts.add(el);
      paint(el);
    },
  };

  function start() {
    if (!window.firebase || !firebase.apps || !firebase.apps.length || typeof tlStatusOf !== "function") return;
    let unsub = null;
    firebase.auth().onAuthStateChanged((user) => {
      if (unsub) unsub();
      memory = null;
      unsub = user ? watch(firebase.firestore(), user.uid) : null;
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
