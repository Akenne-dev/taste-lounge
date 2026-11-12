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
