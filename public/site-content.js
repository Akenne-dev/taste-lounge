/**
 * Taste Lounge — website content
 * ------------------------------
 * Fills the public pages (home, menu gallery, about, our story) with the text,
 * images and lists managed in Admin → Website. Nothing on those pages is typed
 * into the HTML; it all comes from Firestore:
 *
 *   site/general  brand name, opening hours, footer, pop-up messages (all pages)
 *   site/home | site/gallery | site/about | site/story   (one per page)
 *
 * Mark-up (the page sets <html data-cms-page="home">):
 *   data-cms="home.heroTitle"        -> text
 *   data-cms-src="home.promoImage"   -> <img src>
 *   data-cms-bg="home.parallaxImage" -> background-image
 *   data-cms-href="general.instagram"-> link
 *   data-cms-list="home.foods"       -> repeats its <template> for each item;
 *                                       inside it, paths start with "." (".name")
 *
 * window.siteContent  Promise of { general, <page> } for page scripts (e.g. hero videos)
 * window.siteAlert(k) shows the general.<k> message (nav pop-ups)
 * Fires "cms:ready" on document once everything is filled in.
 */
(function () {
  const PAGE = document.documentElement.dataset.cmsPage || "";
  const html = document.documentElement;

  // keep editable bits invisible until the content arrives (no flash of empty/old text)
  html.classList.add("cms-loading");
  const style = document.createElement("style");
  style.textContent =
    "html.cms-loading [data-cms],html.cms-loading [data-cms-src],html.cms-loading [data-cms-bg]," +
    "html.cms-loading [data-cms-href],html.cms-loading [data-cms-list]{visibility:hidden}";
  document.head.appendChild(style);
  const reveal = () => html.classList.remove("cms-loading");
  setTimeout(reveal, 6000); // never leave the page hidden if the network is slow

  // separate named app, so it doesn't interfere with login/auto-logout on these pages
  const app = firebase.apps.find((a) => a.name === "site") || firebase.initializeApp({
    apiKey: "AIzaSyAW3atuDYr7OeuT2b-Tn_ooD93ZfPqMA4g",
    authDomain: "taste-lounge-3075.firebaseapp.com",
    projectId: "taste-lounge-3075",
  }, "site");
  const db = app.firestore();

  const docIds = ["general", PAGE].filter(Boolean);
  const content = Promise.all(docIds.map((id) => db.collection("site").doc(id).get()))
    .then((snaps) => Object.fromEntries(docIds.map((id, i) => [id, snaps[i].exists ? snaps[i].data() : {}])));

  window.siteContent = content;
  window.siteAlert = (key) => {
    content.then((c) => {
      const msg = c.general && c.general[key];
      if (msg) alert(msg);
    });
  };

  // "home.foods" -> content.home.foods ; ".name" -> item.name
  function resolve(path, data, item) {
    if (path.startsWith(".")) return item ? item[path.slice(1)] : undefined;
    return path.split(".").reduce((obj, key) => (obj == null ? undefined : obj[key]), data);
  }

  function fill(root, data, item) {
    const all = (sel) => [...root.querySelectorAll(sel)];

    all("[data-cms]").forEach((el) => {
      const v = resolve(el.dataset.cms, data, item);
      el.textContent = v == null ? "" : String(v);
    });
    all("[data-cms-src]").forEach((el) => {
      const v = resolve(el.dataset.cmsSrc, data, item);
      if (v) el.src = v;
      else el.removeAttribute("src");
      el.style.display = v ? "" : "none";
    });
    all("[data-cms-bg]").forEach((el) => {
      const v = resolve(el.dataset.cmsBg, data, item);
      el.style.backgroundImage = v ? `url("${String(v).replace(/"/g, '\\"')}")` : "none";
    });
    all("[data-cms-href]").forEach((el) => {
      const v = resolve(el.dataset.cmsHref, data, item);
      if (v) el.href = v;
      else el.style.display = "none"; // e.g. a social network you don't use
    });

    // lists last, so items (with "." paths) are filled with their own data
    all("[data-cms-list]").forEach((box) => {
      const template = box.querySelector(":scope > template");
      if (!template) return;
      const items = resolve(box.dataset.cmsList, data, item);
      box.querySelectorAll(":scope > :not(template)").forEach((n) => n.remove());
      (Array.isArray(items) ? items : []).forEach((entry) => {
        const clone = template.content.cloneNode(true);
        fill(clone, data, entry);
        box.appendChild(clone);
      });
    });
  }

  const domReady = new Promise((resolve) => {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", resolve, { once: true });
    else resolve();
  });

  Promise.all([content, domReady])
    .then(([data]) => {
      fill(document, data, null);
      document.dispatchEvent(new CustomEvent("cms:ready", { detail: data }));
    })
    .catch((err) => console.error("Could not load website content:", err))
    .finally(reveal);
})();
