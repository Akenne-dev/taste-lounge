/**
 * Taste Lounge — menu service
 * ---------------------------
 * Loads everything the admin manages in Firestore. Nothing about the menu is
 * hard-coded here: dishes, categories, extras, deals and delivery prices all
 * come from the admin panel (TasteLounge-Admin).
 *
 * Firestore collections
 *   foods/{id}         a dish (see tlNormalizeFood for the fields)
 *   categories/{id}    { name, emoji, order }
 *   extras/{id}        { name, price }   — add-ons a dish can offer
 *   settings/store     { deliveryFee, expressFee, freeDeliveryOver, deliveryTime, deals[] }
 *   ratings/{foodId}   { sum, count }    — totals from customer reviews (reviews/{foodId}__{uid})
 *
 * Usage
 *   const menu = await tlLoadMenu(firebase.firestore());
 *   menu.foods, menu.categories, menu.settings, menu.findFood(id), menu.foodsIn(categoryId)
 */

// Used only if the admin hasn't saved store settings yet.
const TL_SETTINGS_FALLBACK = {
  deliveryFee: 0,
  expressFee: 0,
  freeDeliveryOver: 0,
  deliveryTime: "",
  deals: [],
};

async function tlLoadMenu(db) {
  const [foodSnap, catSnap, extraSnap, settingsSnap, ratingSnap] = await Promise.all([
    db.collection("foods").get(),
    db.collection("categories").get(),
    db.collection("extras").get(),
    db.collection("settings").doc("store").get(),
    // ratings are a bonus: the menu still loads if they can't be read
    db.collection("ratings").get().catch((err) => {
      console.warn("Ratings unavailable:", err.message);
      return { docs: [] };
    }),
  ]);

  const ratings = new Map(ratingSnap.docs.map((d) => [d.id, tlRatingFrom(d.data())]));

  const categories = catSnap.docs
    .map((d) => ({ id: d.id, name: d.data().name || "Untitled", emoji: d.data().emoji || "", order: Number(d.data().order) || 0 }))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

  const extrasById = new Map(
    extraSnap.docs.map((d) => [d.id, { id: d.id, name: d.data().name || "Extra", price: Number(d.data().price) || 0 }])
  );

  const foods = foodSnap.docs
    .map((d) => ({ ...tlNormalizeFood(d.id, d.data(), categories, extrasById), rating: ratings.get(d.id) || null }))
    .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);

  const settings = { ...TL_SETTINGS_FALLBACK, ...(settingsSnap.exists ? settingsSnap.data() : {}) };
  settings.deals = Array.isArray(settings.deals) ? settings.deals.filter(Boolean) : [];
  ["deliveryFee", "expressFee", "freeDeliveryOver"].forEach((k) => (settings[k] = Number(settings[k]) || 0));

  const byId = new Map(foods.map((f) => [f.id, f]));
  return {
    foods,
    categories,
    extras: [...extrasById.values()],
    settings,
    findFood: (id) => byId.get(id) || null,
    foodsIn: (categoryId) => foods.filter((f) => f.categoryId === categoryId && f.available),
  };
}

// Turn a Firestore food document into the shape the pages use.
function tlNormalizeFood(id, d, categories, extrasById) {
  // Older dishes only stored the category name, so fall back to matching it.
  const category =
    categories.find((c) => c.id === d.categoryId) ||
    categories.find((c) => c.name === d.category) ||
    null;

  const sizes = (Array.isArray(d.sizes) ? d.sizes : [])
    .filter((s) => s && s.label)
    .map((s) => ({ id: tlSlug(s.label), label: s.label, note: s.note || "", price: Number(s.price) || 0 }));

  const extras = (Array.isArray(d.extraIds) ? d.extraIds : [])
    .map((x) => extrasById.get(x))
    .filter(Boolean);

  const num = (v) => (v === null || v === undefined || v === "" || isNaN(Number(v)) ? null : Number(v));

  return {
    id,
    name: d.name || "Untitled dish",
    description: d.description || "",
    price: Number(d.price) || 0,
    oldPrice: num(d.oldPrice),
    img: d.imageUrl || "",
    categoryId: category ? category.id : null,
    category,
    ingredients: (Array.isArray(d.ingredients) ? d.ingredients : []).filter(Boolean),
    sizes,
    extras,
    prepTime: d.prepTime || "",
    calories: num(d.calories),
    serves: num(d.serves),
    spice: num(d.spice),
    badge: d.badge || "",
    vegetarian: !!d.vegetarian,
    adult: !!d.adult,
    trending: !!d.trending,
    popular: !!d.popular,
    available: d.available !== false,
    order: num(d.order) ?? Number.MAX_SAFE_INTEGER,
    createdAt: d.createdAt && d.createdAt.toMillis ? d.createdAt.toMillis() : 0,
  };
}

/* ---------------- Ratings ---------------- */

// { sum, count } -> { avg, count }, or null when there are no ratings yet
function tlRatingFrom(totals) {
  const count = Number(totals && totals.count) || 0;
  const sum = Number(totals && totals.sum) || 0;
  return count > 0 ? { avg: Math.round((sum / count) * 10) / 10, count } : null;
}

// Five stars, partly filled to match the rating (e.g. 4.3)
function tlStarsHtml(avg, size = "") {
  const pct = Math.max(0, Math.min(100, (Number(avg) / 5) * 100));
  return `<span class="tl-stars ${size}" style="--pct:${pct}%" role="img" aria-label="${Number(avg).toFixed(1)} out of 5 stars"></span>`;
}

// Short "★ 4.6 (23)" label for cards; empty when a dish has no ratings
function tlRatingBadge(rating) {
  if (!rating) return "";
  return `<span class="tl-rating"><span aria-hidden="true">★</span> ${rating.avg.toFixed(1)} <span class="tl-rating-count">(${rating.count})</span></span>`;
}

/* ---------------- Helpers ---------------- */

function tlFormat(amount) {
  return "₦" + Number(amount || 0).toLocaleString("en-US");
}

function tlEsc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function tlSlug(text) {
  return String(text).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function tlCategoryLabel(food) {
  if (!food || !food.category) return "";
  return `${food.category.name} ${food.category.emoji}`.trim();
}

function tlDetailsUrl(id) {
  return "food-details.html?id=" + encodeURIComponent(id);
}

// Placeholder shown when a dish has no image or the image fails to load.
const TL_IMG_FALLBACK = "this.onerror=null;this.src='taste-lounge-logo.png';this.classList.add('img-fallback')";

/* ---------------- Cart lines & "Order again" ---------------- */

function tlReadCart() {
  try {
    const cart = JSON.parse(localStorage.getItem("cart"));
    return Array.isArray(cart) ? cart : [];
  } catch (e) {
    return [];
  }
}

// Same line shape as the dish page: same dish + same options = same cart line,
// and the default options use the plain dish id (so it merges with quick "Add to Cart").
function tlCartLine(food, size, picked = [], quantity = 1, note = "") {
  if (!size && food.sizes.length) size = food.sizes[0];
  const isDefault = !size || !food.sizes.length || size.id === food.sizes[0].id;
  const id = [food.id, ...(isDefault ? [] : [size.id]), ...picked.map((e) => e.id).sort()].join("__");
  let name = food.name;
  if (!isDefault) name += ` (${size.label})`;
  if (picked.length) name += " + " + picked.map((e) => e.name).join(", ");
  return {
    id,
    foodId: food.id,
    name,
    price: food.price + (size ? size.price : 0) + picked.reduce((sum, e) => sum + e.price, 0),
    image: food.img,
    quantity,
    size: size ? size.label : null,
    extras: picked.map((e) => e.name),
    note: note || "",
  };
}

// Put a past order's dishes back in the cart at today's prices. Dishes that were
// removed or are sold out are skipped. Returns { added, skipped: [names] }.
async function tlReorder(db, uid, items, menu = null) {
  menu = menu || (await tlLoadMenu(db));
  const cart = tlReadCart();
  let added = 0;
  const skipped = [];

  (items || []).forEach((item) => {
    const food = menu.findFood(item.foodId || String(item.id || "").split("__")[0]);
    if (!food || !food.available) {
      skipped.push(item.name || "A dish");
      return;
    }
    const size = food.sizes.find((s) => s.label === item.size) || null;
    const picked = food.extras.filter((e) => (item.extras || []).includes(e.name));
    const qty = Math.max(1, Number(item.quantity ?? item.qty) || 1);
    const line = tlCartLine(food, size, picked, qty, item.note);
    const existing = cart.find((c) => c.id === line.id);
    if (existing) {
      existing.quantity = (Number(existing.quantity) || 0) + qty;
      existing.price = line.price;
    } else {
      cart.push(line);
    }
    added += qty;
  });

  localStorage.setItem("cart", JSON.stringify(cart));
  if (uid) await db.collection("users").doc(uid).set({ cart }, { merge: true });
  return { added, skipped };
}

/* ---------------- Payment methods ----------------
   Paystack's payment channels. Admin → Store Settings picks which ones customers
   can use (settings.paymentChannels); none picked = whatever Paystack allows. */
const TL_PAYMENT_CHANNELS = {
  card: { icon: "💳", label: "Card" },
  bank_transfer: { icon: "🏦", label: "Bank transfer" },
  ussd: { icon: "📱", label: "USSD" },
  bank: { icon: "🏛️", label: "Pay with bank app" },
  qr: { icon: "🔳", label: "QR code" },
  mobile_money: { icon: "📲", label: "Mobile money" },
};

function tlPaymentChannels(settings) {
  const list = Array.isArray(settings && settings.paymentChannels) ? settings.paymentChannels : [];
  return list.filter((c) => TL_PAYMENT_CHANNELS[c]);
}

/* ---------------- Loyalty points (Admin → Store Settings) ----------------
   settings.loyalty = { enabled, earnPerAmount, pointValue, minRedeem }
     earnPerAmount: ₦ spent for 1 point      pointValue: ₦ one point is worth
   Each order stores loyalty = { earned, redeemed }. Earned points count once the
   order is marked "delivered"; points spent count straight away (unless cancelled). */

function tlLoyaltyConfig(settings) {
  const l = (settings && settings.loyalty) || {};
  const cfg = {
    earnPerAmount: Number(l.earnPerAmount) || 0,
    pointValue: Number(l.pointValue) || 0,
    minRedeem: Math.max(0, Math.floor(Number(l.minRedeem) || 0)),
  };
  cfg.enabled = l.enabled === true && cfg.earnPerAmount > 0 && cfg.pointValue > 0;
  return cfg;
}

function tlPointsFor(amount, cfg) {
  return cfg && cfg.enabled ? Math.max(0, Math.floor(Number(amount || 0) / cfg.earnPerAmount)) : 0;
}

// orders: array of order documents (data) for one customer
function tlLoyaltyBalance(orders) {
  let earned = 0, pending = 0, redeemed = 0;
  (orders || []).forEach((o) => {
    const status = (o.status && o.status.current) || "paid";
    if (status === "cancelled") return;
    const l = o.loyalty || {};
    if (status === "delivered") earned += Number(l.earned) || 0;
    else pending += Number(l.earned) || 0;
    redeemed += Number(l.redeemed) || 0;
  });
  return { balance: Math.max(0, earned - redeemed), pending, earned, redeemed };
}
