/**
 * Taste Lounge — profile page account features
 * --------------------------------------------
 * Edit profile, change password, saved addresses, payment methods, loyalty points,
 * one-tap re-order and "install app". Saved to Firestore users/{uid}:
 *   username, phone, address (the default address), addresses: [{ id, label, name, phone, address, isDefault }]
 * Needs menu-service.js (tlEsc, tlFormat, tlReorder, loyalty + payment helpers).
 *
 *   tlAccount.init({ user, db, data, orders })   // data = users/{uid}, orders = [{ id, ...order }]
 */
const tlAccount = (() => {
  let ctx = null;
  let settings = {};
  let lastFocus = null;

  const $ = (id) => document.getElementById(id);
  const esc = (v) => tlEsc(v);
  const userRef = () => ctx.db.collection("users").doc(ctx.user.uid);
  const now = () => firebase.firestore.FieldValue.serverTimestamp();
  const ms = (ts) => (ts && ts.toMillis ? ts.toMillis() : 0);

  /* ---------------- small UI helpers ---------------- */
  function toast(text) {
    let el = $("tlToast");
    if (!el) {
      el = document.createElement("div");
      el.id = "tlToast";
      el.setAttribute("role", "status");
      el.style.cssText = "position:fixed;left:50%;bottom:90px;pointer-events:none;transform:translateX(-50%);z-index:10060;background:#1A1A1A;color:#fff;padding:12px 18px;border-radius:999px;font:600 14px Inter,Poppins,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.25);transition:opacity .3s;max-width:90vw;text-align:center";
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.style.opacity = "1";
    clearTimeout(el._t);
    el._t = setTimeout(() => (el.style.opacity = "0"), 2600);
  }

  function closeSheet() {
    const open = document.querySelector(".tl-sheet-backdrop");
    if (open) open.remove();
    document.removeEventListener("keydown", onKey);
    document.body.style.overflow = "";
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function onKey(e) {
    if (e.key === "Escape") closeSheet();
  }

  // Opens a sheet; build(body) fills it. Any [data-close] element closes it.
  function openSheet(title, build) {
    closeSheet();
    lastFocus = document.activeElement;
    const backdrop = document.createElement("div");
    backdrop.className = "tl-sheet-backdrop";
    backdrop.innerHTML = `
      <div class="tl-sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="tl-sheet-head"><h3>${esc(title)}</h3><button type="button" class="tl-sheet-close" data-close aria-label="Close">×</button></div>
        <div class="tl-sheet-body"></div>
      </div>`;
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop || e.target.closest("[data-close]")) closeSheet();
    });
    document.body.appendChild(backdrop);
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    const body = backdrop.querySelector(".tl-sheet-body");
    build(body);
    const first = body.querySelector("input:not([readonly]), textarea, button");
    (first || backdrop.querySelector(".tl-sheet-close")).focus();
    return body;
  }

  function message(body, text, kind = "error") {
    const el = body.querySelector(".tl-msg");
    if (!el) return;
    el.textContent = text;
    el.className = "tl-msg " + kind;
  }

  function busy(btn, on, label) {
    btn.disabled = on;
    if (label) btn.textContent = label;
  }

  /* ---------------- edit profile ---------------- */
  function currentName() {
    return ctx.data.username || ctx.user.displayName || (ctx.user.email || "").split("@")[0] || "";
  }

  function refreshHeader() {
    const name = currentName();
    $("profileHeroName").textContent = name;
    $("profileInfoName").textContent = name;
    $("profilePhone").textContent = ctx.data.phone || "-";
    $("profileAddress").textContent = ctx.data.address || "-";
    const avatar = $("avatarInitial");
    if (avatar && !avatar.querySelector("img")) avatar.textContent = name.charAt(0).toUpperCase();
  }

  function editProfile() {
    openSheet("Edit profile", (body) => {
      body.innerHTML = `
        <form novalidate>
          <label class="tl-field"><span>Name</span>
            <input name="name" maxlength="60" autocomplete="name" value="${esc(currentName())}" required></label>
          <label class="tl-field"><span>Phone number</span>
            <input name="phone" type="tel" inputmode="tel" maxlength="20" autocomplete="tel" placeholder="e.g. 0803 123 4567" value="${esc(ctx.data.phone || "")}"></label>
          <label class="tl-field"><span>Email</span>
            <input value="${esc(ctx.user.email || "")}" readonly>
            <small>You sign in with this email, so it can't be changed here.</small></label>
          <p class="tl-msg" role="status"></p>
          <div class="tl-actions">
            <button type="button" class="tl-btn ghost" data-close>Cancel</button>
            <button type="submit" class="tl-btn">Save changes</button>
          </div>
        </form>`;
      const form = body.querySelector("form");
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const name = form.elements.namedItem("name").value.trim().replace(/\s+/g, " ");
        const phone = form.phone.value.trim();
        if (name.length < 2) return message(body, "Please enter your name.");
        if (phone && !/^\+?[0-9 ()-]{7,20}$/.test(phone)) return message(body, "That phone number doesn't look right.");
        const btn = form.querySelector('[type="submit"]');
        busy(btn, true, "Saving…");
        try {
          await userRef().set({ username: name, phone, updatedAt: now() }, { merge: true });
          ctx.user.updateProfile({ displayName: name }).catch(() => { });
          Object.assign(ctx.data, { username: name, phone });
          refreshHeader();
          closeSheet();
          toast("Profile updated");
        } catch (err) {
          console.error("Profile save failed:", err);
          message(body, "Couldn't save your changes. Please try again.");
          busy(btn, false, "Save changes");
        }
      });
    });
  }

  /* ---------------- change password ---------------- */
  const PASSWORD_ERRORS = {
    "auth/wrong-password": "Your current password is wrong.",
    "auth/invalid-credential": "Your current password is wrong.",
    "auth/invalid-login-credentials": "Your current password is wrong.",
    "auth/too-many-requests": "Too many tries. Please wait a few minutes and try again.",
    "auth/weak-password": "Please choose a stronger password (at least 8 characters).",
    "auth/network-request-failed": "No internet connection. Please try again.",
    "auth/requires-recent-login": "For your security, please log out and log in again, then change your password.",
  };

  function changePassword() {
    const hasPassword = (ctx.user.providerData || []).some((p) => p.providerId === "password");
    openSheet("Change password", (body) => {
      if (!hasPassword) {
        body.innerHTML = `
          <div class="tl-note">You sign in with <b>Google</b>, so there's no Taste Lounge password to change.
            Your password is managed by your Google account.</div>
          <div class="tl-actions">
            <button type="button" class="tl-btn ghost" data-close>Close</button>
            <a class="tl-btn" style="text-align:center;text-decoration:none" href="https://myaccount.google.com/security" target="_blank" rel="noopener">Manage Google account</a>
          </div>`;
        return;
      }
      body.innerHTML = `
        <form novalidate>
          <label class="tl-field"><span>Current password</span>
            <input name="current" type="password" autocomplete="current-password" required></label>
          <label class="tl-field"><span>New password</span>
            <input name="next" type="password" autocomplete="new-password" minlength="8" required>
            <small>At least 8 characters.</small></label>
          <label class="tl-field"><span>Confirm new password</span>
            <input name="confirm" type="password" autocomplete="new-password" required></label>
          <p class="tl-msg" role="status"></p>
          <div class="tl-actions">
            <button type="button" class="tl-btn ghost" data-close>Cancel</button>
            <button type="submit" class="tl-btn">Update password</button>
          </div>
          <p style="text-align:center;margin:14px 0 0"><button type="button" class="tl-link" data-forgot>Forgot your current password?</button></p>
        </form>`;
      const form = body.querySelector("form");
      form.querySelector("[data-forgot]").onclick = async () => {
        try {
          await firebase.auth().sendPasswordResetEmail(ctx.user.email);
          message(body, `We've emailed a reset link to ${ctx.user.email}.`, "ok");
        } catch (err) {
          message(body, PASSWORD_ERRORS[err.code] || "Couldn't send the reset email. Please try again.");
        }
      };
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const current = form.current.value;
        const next = form.next.value;
        if (!current) return message(body, "Enter your current password.");
        if (next.length < 8) return message(body, "Your new password needs at least 8 characters.");
        if (next !== form.confirm.value) return message(body, "The new passwords don't match.");
        if (next === current) return message(body, "Your new password must be different from the current one.");
        const btn = form.querySelector('[type="submit"]');
        busy(btn, true, "Updating…");
        try {
          const cred = firebase.auth.EmailAuthProvider.credential(ctx.user.email, current);
          await ctx.user.reauthenticateWithCredential(cred);
          await ctx.user.updatePassword(next);
          closeSheet();
          toast("Password updated");
        } catch (err) {
          message(body, PASSWORD_ERRORS[err.code] || "Couldn't update your password. Please try again.");
          busy(btn, false, "Update password");
        }
      });
    });
  }

  /* ---------------- saved addresses ---------------- */
  function addresses() {
    return Array.isArray(ctx.data.addresses) ? ctx.data.addresses.filter((a) => a && a.address) : [];
  }

  async function saveAddresses(list) {
    if (list.length && !list.some((a) => a.isDefault)) list[0].isDefault = true;
    const def = list.find((a) => a.isDefault);
    const patch = { addresses: list, address: def ? def.address : "", updatedAt: now() };
    if (def && def.phone && !ctx.data.phone) patch.phone = def.phone;
    await userRef().set(patch, { merge: true });
    ctx.data.addresses = list;
    ctx.data.address = patch.address;
    if (patch.phone) ctx.data.phone = patch.phone;
    refreshHeader();
  }

  function openAddresses() {
    openSheet("Saved addresses", (body) => renderAddressList(body));
  }

  function renderAddressList(body) {
    const list = addresses();
    body.innerHTML = `
      ${list.length ? list.map((a, i) => `
        <div class="tl-addr ${a.isDefault ? "is-default" : ""}">
          <div class="tl-addr-top"><b>${esc(a.label || "Address")}</b>${a.isDefault ? `<span class="tl-tag">Default</span>` : ""}</div>
          <p>${esc(a.address)}${a.name || a.phone ? `<br><small style="color:#888">${esc([a.name, a.phone].filter(Boolean).join(" · "))}</small>` : ""}</p>
          <div class="tl-addr-actions">
            ${a.isDefault ? "" : `<button type="button" class="tl-link" data-default="${i}">Make default</button>`}
            <button type="button" class="tl-link" data-edit="${i}">Edit</button>
            <button type="button" class="tl-link" data-delete="${i}" style="color:#777">Delete</button>
          </div>
        </div>`).join("") : `<p class="tl-empty">No saved addresses yet. Add one to check out faster.</p>`}
      <p class="tl-msg" role="status"></p>
      <div class="tl-actions"><button type="button" class="tl-btn" data-add>＋ Add a new address</button></div>`;

    body.onclick = async (e) => {
      const t = e.target;
      if (t.closest("[data-add]")) return renderAddressForm(body, null);
      if (t.dataset.edit !== undefined) return renderAddressForm(body, Number(t.dataset.edit));
      const list2 = addresses().map((a) => ({ ...a }));
      try {
        if (t.dataset.default !== undefined) {
          list2.forEach((a, i) => (a.isDefault = i === Number(t.dataset.default)));
          await saveAddresses(list2);
          toast("Default address updated");
          renderAddressList(body);
        } else if (t.dataset.delete !== undefined) {
          const a = list2[Number(t.dataset.delete)];
          if (!confirm(`Delete "${a.label || "this address"}"?`)) return;
          list2.splice(Number(t.dataset.delete), 1);
          await saveAddresses(list2);
          toast("Address deleted");
          renderAddressList(body);
        }
      } catch (err) {
        console.error("Address save failed:", err);
        message(body, "Couldn't save. Please try again.");
      }
    };
  }

  function renderAddressForm(body, index) {
    const list = addresses();
    const editing = index !== null ? list[index] : null;
    // first address: start from what checkout saved last time
    const a = editing || {
      label: list.length ? "" : "Home",
      name: ctx.data.name || currentName(),
      phone: ctx.data.phone || "",
      address: list.length ? "" : ctx.data.address || "",
    };
    body.onclick = null;
    body.innerHTML = `
      <form novalidate>
        <label class="tl-field"><span>Label</span>
          <input name="label" maxlength="30" placeholder="e.g. Home, Work, Mum's place" value="${esc(a.label || "")}"></label>
        <label class="tl-field"><span>Name for delivery</span>
          <input name="name" maxlength="60" autocomplete="name" value="${esc(a.name || "")}"></label>
        <label class="tl-field"><span>Phone number</span>
          <input name="phone" type="tel" inputmode="tel" maxlength="20" autocomplete="tel" value="${esc(a.phone || "")}"></label>
        <label class="tl-field"><span>Address</span>
          <textarea name="address" rows="3" maxlength="300" autocomplete="street-address" placeholder="House number, street, area, landmark">${esc(a.address || "")}</textarea></label>
        <label class="tl-field" style="display:flex;align-items:center;gap:10px">
          <input name="isDefault" type="checkbox" style="width:20px;height:20px;accent-color:#ff0000" ${editing ? (editing.isDefault ? "checked" : "") : list.length ? "" : "checked"}>
          <span style="margin:0">Use as my default address</span></label>
        <p class="tl-msg" role="status"></p>
        <div class="tl-actions">
          <button type="button" class="tl-btn ghost" data-back>Back</button>
          <button type="submit" class="tl-btn">${editing ? "Save address" : "Add address"}</button>
        </div>
      </form>`;
    const form = body.querySelector("form");
    form.querySelector("[data-back]").onclick = () => renderAddressList(body);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const entry = {
        id: editing ? editing.id || "a" + Date.now().toString(36) : "a" + Date.now().toString(36),
        label: form.label.value.trim() || `Address ${list.length + (editing ? 0 : 1)}`,
        name: form.elements.namedItem("name").value.trim(),
        phone: form.phone.value.trim(),
        address: form.address.value.trim(),
        isDefault: form.isDefault.checked,
      };
      if (entry.address.length < 5) return message(body, "Please enter the full address.");
      if (entry.phone && !/^\+?[0-9 ()-]{7,20}$/.test(entry.phone)) return message(body, "That phone number doesn't look right.");
      const next = list.map((x) => ({ ...x }));
      if (entry.isDefault) next.forEach((x) => (x.isDefault = false));
      if (editing) next[index] = entry;
      else next.push(entry);
      const btn = form.querySelector('[type="submit"]');
      busy(btn, true, "Saving…");
      try {
        await saveAddresses(next);
        toast(editing ? "Address saved" : "Address added");
        renderAddressList(body);
      } catch (err) {
        console.error("Address save failed:", err);
        message(body, "Couldn't save. Please try again.");
        busy(btn, false, editing ? "Save address" : "Add address");
      }
    });
  }

  /* ---------------- payment methods ---------------- */
  function openPayments() {
    openSheet("Payment methods", (body) => {
      const channels = tlPaymentChannels(settings);
      const paid = ctx.orders.filter((o) => o.payment && o.payment.status === "success").slice(0, 5);
      body.innerHTML = `
        <div class="tl-note">🔒 Payments are processed securely by <b>Paystack</b>. Taste Lounge never sees or stores your card details —
          you choose how to pay each time you check out.</div>
        <p class="tl-sub">Ways to pay</p>
        ${channels.length
          ? `<div class="tl-chips">${channels.map((c) => `<span>${TL_PAYMENT_CHANNELS[c].icon} ${esc(TL_PAYMENT_CHANNELS[c].label)}</span>`).join("")}</div>`
          : `<p style="font-size:14px;color:#555;margin:6px 0 16px">Card, bank transfer, USSD and more — pick your favourite at checkout.</p>`}
        <p class="tl-sub">Recent payments</p>
        ${paid.length ? `<ul class="tl-list">${paid.map((o) => `
          <li><span>Order #${esc(o.id.slice(0, 4).toUpperCase())}
            <small>${ms(o.createdAt) ? new Date(ms(o.createdAt)).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : ""}${o.payment.reference ? " · Ref " + esc(o.payment.reference) : ""}</small></span>
            <b>${tlFormat(o.pricing && o.pricing.total)}</b></li>`).join("")}</ul>`
          : `<p class="tl-empty">No payments yet.</p>`}
        <div class="tl-actions" style="margin-top:16px"><button type="button" class="tl-btn ghost" data-close>Close</button></div>`;
    });
  }

  /* ---------------- loyalty points ---------------- */
  function renderPoints() {
    const el = $("statPoints");
    if (!el) return;
    const cfg = tlLoyaltyConfig(settings);
    const pts = tlLoyaltyBalance(ctx.orders);
    el.textContent = pts.balance.toLocaleString();
    // the whole "Loyalty Points" row is the tap target, not just the number
    const row = el.closest("li") || el;
    row.classList.add("tl-points-row");
    row.title = "See your points";
    row.setAttribute("role", "button");
    row.setAttribute("tabindex", "0");
    el.dataset.ready = "1";
  }

  function openPoints() {
    const cfg = tlLoyaltyConfig(settings);
    const pts = tlLoyaltyBalance(ctx.orders);
    const history = ctx.orders.filter((o) => o.loyalty && (o.loyalty.earned || o.loyalty.redeemed)).slice(0, 8);
    openSheet("Loyalty points", (body) => {
      body.innerHTML = `
        <div class="tl-points-hero">
          <strong>${pts.balance.toLocaleString()}</strong>
          <span>points${cfg.enabled ? ` · worth ${tlFormat(pts.balance * cfg.pointValue)}` : ""}</span>
          ${pts.pending ? `<div style="margin-top:6px;font-size:13px">+${pts.pending.toLocaleString()} on the way from orders not yet delivered</div>` : ""}
        </div>
        ${cfg.enabled ? `
          <div class="tl-note"><b>How it works</b><br>
            Earn 1 point for every ${tlFormat(cfg.earnPerAmount)} you spend on food. Points are added once your order is delivered.<br>
            Each point is worth ${tlFormat(cfg.pointValue)} off at checkout${cfg.minRedeem > 1 ? ` once you have ${cfg.minRedeem.toLocaleString()} points` : ""}.</div>`
          : `<div class="tl-note">The loyalty programme is paused right now. Your points are safe.</div>`}
        ${history.length ? `<p class="tl-sub">History</p><ul class="tl-list">${history.map((o) => {
          const status = (o.status && o.status.current) || "paid";
          const earned = Number(o.loyalty.earned) || 0, used = Number(o.loyalty.redeemed) || 0;
          return `<li><span>Order #${esc(o.id.slice(0, 4).toUpperCase())}
            <small>${typeof tlStatusLabel === "function" ? esc(tlStatusLabel(o)) : status === "delivered" ? "Delivered" : status === "cancelled" ? "Cancelled" : "In progress"}</small></span>
            <span style="text-align:right">${earned ? `<span class="tl-plus">+${earned}</span>${status === "delivered" ? "" : " <small>(pending)</small>"}` : ""}
            ${used ? `<br><span class="tl-minus">−${used}</span>` : ""}</span></li>`;
        }).join("")}</ul>` : ""}
        <div class="tl-actions" style="margin-top:16px"><button type="button" class="tl-btn ghost" data-close>Close</button>
          <a class="tl-btn" href="foods.html" style="text-align:center;text-decoration:none">Order now</a></div>`;
    });
  }

  /* ---------------- one-tap re-order ---------------- */
  async function reorderLast(btn) {
    const last = ctx.orders.find((o) => (o.items || []).length && (o.status && o.status.current) !== "cancelled");
    if (!last) {
      toast("No past orders yet — let's find something tasty!");
      setTimeout(() => (location.href = "foods.html"), 1200);
      return;
    }
    const label = btn.textContent;
    busy(btn, true, "Adding…");
    try {
      const { added, skipped } = await tlReorder(ctx.db, ctx.user.uid, last.items);
      if (!added) {
        alert("Sorry — the dishes from your last order aren't available right now.");
        return;
      }
      if (skipped.length) alert(`Added to your cart. Not available right now: ${skipped.join(", ")}.`);
      location.href = "cart.html";
    } catch (err) {
      console.error("Re-order failed:", err);
      alert("Couldn't add your last order to the cart. Please try again.");
    } finally {
      busy(btn, false, label);
    }
  }

  /* ---------------- install app ---------------- */
  function setupInstall() {
    const row = $("installRow");
    if (!row || !window.tlPwa) return;
    const update = () => {
      row.hidden = window.tlPwa.isStandalone() || !(window.tlPwa.canInstall() || window.tlPwa.isIOS);
    };
    update();
    document.addEventListener("tl:installable", update);
    document.addEventListener("tl:installed", update);
    $("installBtn").onclick = () => window.tlPwa.install();
  }

  /* ---------------- wiring ---------------- */
  function init(options) {
    ctx = { ...options, data: options.data || {}, orders: options.orders || [] };
    ctx.orders.sort((a, b) => ms(b.createdAt) - ms(a.createdAt));

    $("editProfileBtn").onclick = editProfile;
    $("changePasswordBtn").onclick = changePassword;
    document.querySelectorAll(".quick-actions [data-action]").forEach((btn) => {
      btn.onclick = () => {
        const action = btn.dataset.action;
        if (action === "orders") location.href = "orders.html";
        if (action === "address") openAddresses();
        if (action === "payment") openPayments();
        if (action === "reorder") reorderLast(btn);
      };
    });
    const points = $("statPoints").closest("li") || $("statPoints");
    points.onclick = openPoints;
    points.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openPoints();
      }
    };

    setupInstall();
    renderPoints();
    // loyalty + payment settings come from Admin → Store Settings
    ctx.db.collection("settings").doc("store").get()
      .then((snap) => {
        settings = snap.exists ? snap.data() : {};
        renderPoints();
      })
      .catch((err) => console.warn("Store settings unavailable:", err.message));
  }

  return { init, openAddresses, openPayments, openPoints, editProfile, changePassword };
})();
