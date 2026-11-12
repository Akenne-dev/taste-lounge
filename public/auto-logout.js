(function () {
  const IDLE_LIMIT_MS = 45 * 60 * 1000; // 45 minute (testing)
  const CHECK_INTERVAL_MS = 15000;
  const ACTIVITY_WRITE_THROTTLE_MS = 10000;
  const MAX_AUTH_WAIT_MS = 60000;
  const ACTIVITY_KEY = "tck:lastActivityAt";
  const LOGOUT_BROADCAST_KEY = "tck:forceLogoutAt";

  let authInstance = null;
  let logoutInProgress = false;
  let activityBound = false;
  let lastActivityWriteAt = 0;

  function now() {
    return Date.now();
  }

  function readLastActivity() {
    const value = Number(localStorage.getItem(ACTIVITY_KEY));
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  function markActivity() {
    const timestamp = now();
    if (timestamp - lastActivityWriteAt < ACTIVITY_WRITE_THROTTLE_MS) {
      return;
    }

    lastActivityWriteAt = timestamp;
    localStorage.setItem(ACTIVITY_KEY, String(timestamp));
  }

  function redirectToLogin() {
    const path = (window.location.pathname || "").toLowerCase();
    if (path.endsWith("/log-in.html") || path.endsWith("/sign-in.html")) {
      return;
    }

    window.location.href = "log-in.html?reason=inactive";
  }

  async function runLogout(auth, shouldBroadcast) {
    if (logoutInProgress || !auth || !auth.currentUser) {
      return;
    }

    logoutInProgress = true;

    try {
      if (shouldBroadcast) {
        localStorage.setItem(LOGOUT_BROADCAST_KEY, String(now()));
      }

      await auth.signOut();
    } catch (error) {
      console.error("Auto-logout failed:", error);
    } finally {
      redirectToLogin();
    }
  }

  function checkIdleTimeout() {
    if (!authInstance || !authInstance.currentUser) {
      return;
    }

    const lastActivity = readLastActivity();
    if (!lastActivity) {
      markActivity();
      return;
    }

    const inactiveFor = now() - lastActivity;
    if (inactiveFor >= IDLE_LIMIT_MS) {
      runLogout(authInstance, true);
    }
  }

  function bindActivityListeners() {
    if (activityBound) {
      return;
    }

    activityBound = true;
    const events = [
      "click",
      "keydown",
      "mousemove",
      "scroll",
      "touchstart",
      "pointerdown",
    ];

    events.forEach((eventName) => {
      window.addEventListener(eventName, markActivity, { passive: true });
    });
  }

  function waitForAuthReady() {
    if (!window.firebase || typeof window.firebase.auth !== "function") {
      return false;
    }

    if (!Array.isArray(window.firebase.apps) || window.firebase.apps.length === 0) {
      return false;
    }

    try {
      authInstance = window.firebase.auth();
      return !!authInstance;
    } catch (_error) {
      return false;
    }
  }

  function initAutoLogout() {
    bindActivityListeners();

    authInstance.onAuthStateChanged((user) => {
      if (user) {
        logoutInProgress = false;
        markActivity();
      }
    });

    window.addEventListener("storage", (event) => {
      if (event.key === LOGOUT_BROADCAST_KEY) {
        runLogout(authInstance, false);
      }
    });

    setInterval(checkIdleTimeout, CHECK_INTERVAL_MS);
  }

  const startedAt = now();
  const startInterval = setInterval(() => {
    if (!waitForAuthReady()) {
      if (now() - startedAt > MAX_AUTH_WAIT_MS) {
        clearInterval(startInterval);
      }
      return;
    }

    clearInterval(startInterval);
    initAutoLogout();
  }, 500);
})();
