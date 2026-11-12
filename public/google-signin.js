// "Continue with Google" — used by log-in.html and sign-in.html.
// Needs firebase-app, firebase-auth and firebase-firestore (v8) loaded and firebase.initializeApp() called.
//
//   <button type="button" class="google-btn" data-google-signin data-redirect="foods.html">…</button>
//   <p id="text" class="login-message"></p>   (optional: success message)
(function () {
  const MESSAGES = {
    "auth/popup-closed-by-user": "",
    "auth/cancelled-popup-request": "",
    "auth/user-cancelled": "",
    "auth/popup-blocked":
      "Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.",
    "auth/operation-not-allowed":
      "Google sign-in isn't switched on yet. Please use your email and password for now.",
    "auth/unauthorized-domain":
      "Google sign-in isn't allowed on this web address yet. Please use your email and password for now.",
    "auth/network-request-failed":
      "No internet connection. Check your network and try again.",
    "auth/account-exists-with-different-credential":
      "This email already has an account. Log in with your email and password instead.",
    "auth/user-disabled": "This account has been disabled. Please contact Taste Lounge.",
    "auth/too-many-requests": "Too many attempts. Please wait a moment and try again.",
  };

  function nameFrom(user) {
    const name = String(user.displayName || "").trim();
    if (name) return name.slice(0, 60);
    return user.email ? user.email.split("@")[0] : "Taste Lounge User";
  }

  // Make sure users/{uid} exists with the fields the app and admin rely on
  // (admin "Users" lists them by createdAt). Never overwrites a name the user already has.
  async function ensureUserDoc(user) {
    const db = firebase.firestore();
    const ref = db.collection("users").doc(user.uid);
    const now = firebase.firestore.FieldValue.serverTimestamp();
    const snap = await ref.get();

    if (!snap.exists) {
      await ref.set({
        username: nameFrom(user),
        email: user.email || "",
        photoURL: user.photoURL || "",
        provider: "google",
        createdAt: now,
      });
      return;
    }

    const data = snap.data() || {};
    const patch = {};
    if (!String(data.username || "").trim()) patch.username = nameFrom(user);
    if (!data.email && user.email) patch.email = user.email;
    if (!data.createdAt) patch.createdAt = now;
    if (user.photoURL && data.photoURL !== user.photoURL) patch.photoURL = user.photoURL;
    if (!data.provider) patch.provider = "google";
    if (Object.keys(patch).length) await ref.set(patch, { merge: true });
  }

  function setBusy(btn, busy) {
    btn.disabled = busy;
    btn.classList.toggle("is-busy", busy);
    const label = btn.querySelector(".google-btn-label");
    if (label) label.textContent = busy ? "Connecting…" : btn.dataset.label;
  }

  async function signIn(btn) {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    setBusy(btn, true);

    let user;
    try {
      // Must run straight from the click, or the browser blocks the pop-up.
      const result = await firebase.auth().signInWithPopup(provider);
      user = result.user;
    } catch (err) {
      setBusy(btn, false);
      const msg = err && err.code in MESSAGES ? MESSAGES[err.code] : (err && err.message) || "Google sign-in failed. Please try again.";
      if (msg) alert(msg);
      return;
    }

    try {
      await ensureUserDoc(user);
    } catch (err) {
      // Signed in fine; the profile page fills in anything missing later.
      console.warn("Could not save the user profile:", err);
    }

    const label = btn.querySelector(".google-btn-label");
    if (label) label.textContent = "Signed in ✓";
    const text = document.getElementById("text");
    if (text) {
      text.textContent = `Welcome, ${nameFrom(user).split(" ")[0]}! Redirecting...`;
      text.classList.add("active");
    }
    setTimeout(() => {
      location.href = btn.dataset.redirect || "foods.html";
    }, 1200);
  }

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-google-signin]");
    if (!btn || btn.disabled) return;
    e.preventDefault();
    if (!btn.dataset.label) {
      const label = btn.querySelector(".google-btn-label");
      btn.dataset.label = label ? label.textContent : "";
    }
    signIn(btn);
  });
})();
