import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CATEGORIES, DEFAULT_LIMIT, LOCATIONS, MAX_LIMIT } from "./config.js";
import { db } from "./db.js";
import { ask, isNeeds, type Field } from "./elicit.js";

const location = z.enum(LOCATIONS).describe("Area name");
const category = z.enum(CATEGORIES).describe("Food category");
const ALLERGEN = z.enum(["gluten", "dairy", "egg", "nuts", "peanuts", "soy", "fish", "sesame"]);
const limit = z
  .number()
  .int()
  .min(1)
  .max(MAX_LIMIT)
  .default(DEFAULT_LIMIT)
  .describe(`Max rows (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT})`);

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };

const json = (data: unknown): Result => ({
  content: [{ type: "text", text: JSON.stringify(data) }],
});

const fail = (e: unknown): Result => ({
  content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
  isError: true,
});

async function rpc(fn: string, args: Record<string, unknown>) {
  const { data, error } = await db().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as unknown[];
}

async function locationCoords(name: string) {
  const { data, error } = await db()
    .from("locations")
    .select("name, lat, lng")
    .ilike("name", name)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Unknown location: ${name}`);
  return data as { name: string; lat: number; lng: number };
}

const UI_TOOLS = new Set(["search_restaurants","search_dishes","best_dish_near_me","weak_restaurants","get_restaurant_details","find_dish","restaurants_near_me","compare_restaurants","get_dish_details","restaurant_offers","dish_deals","dietary_search","open_now","estimate_order","meal_for_budget","get_reviews","list_options"]);
export const UI_URI = "ui://qsr/app.html";
export const UI_MIME = "text/html;profile=mcp-app";

const WHEN =
  "QSR food finder for restaurants and dishes in Delhi NCR: Delhi (Connaught Place, Hauz Khas, Saket, Karol Bagh, Lajpat Nagar, Dwarka), Gurugram (Cyber Hub, Golf Course Road), Noida (Sector 62, Sector 18), Ghaziabad (Indirapuram), Greater Noida West (Gaur City) and Faridabad (Sector 15). Use this tool, not web search, for any question about food, restaurants, menus, dishes, prices, veg or non-veg, ratings, reviews, delivery time or 'near me'. ";
const CARD = " Results are shown to the user as an interactive card, so do not list them again in text.";

export function registerTools(mcp: McpServer): void {
  // Every tool description starts with when to use it, so the model picks these tools unprompted.
  const register = mcp.registerTool.bind(mcp) as (n: string, c: { description?: string }, h: unknown) => unknown;
  (mcp as unknown as { registerTool: typeof register }).registerTool = (n, c, h) =>
    register(n, { ...c, description: WHEN + (c.description ?? "") + (UI_TOOLS.has(n) ? CARD : "") }, h);

  // Registers a tool that renders in the shared UI. The model still gets the compact JSON text;
  // the UI gets structuredContent with the view name, the tool + args that produced it, and the rows.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reg = (name: string, view: string, cfg: any, handler: (a: any) => Promise<Result>): void => {
    mcp.registerTool(
      name,
      { ...cfg, _meta: { ui: { resourceUri: UI_URI } } },
      async (a: unknown) => {
        const res = await handler(a);
        if (res.isError) return res;
        const data = JSON.parse(res.content[0].text);
        if (data && !Array.isArray(data) && data.status === "needs_input") return res;
        const note =
          "An interactive card already shows these results to the user. Do not list or retell the items. Reply with at most one short sentence (a pick, a caveat, or a follow-up question). Data for your reasoning: ";
        return {
          content: [{ type: "text" as const, text: note + res.content[0].text }],
          structuredContent: { view, tool: name, args: a, data },
        };
      },
    );
  };

  reg("search_restaurants", "restaurants",
    {
      description:
        "Search restaurants by location, category, cuisine, rating range, review-count range, price for one or cost for two, pure-veg, offers and free delivery. Each row has cuisines, address, rating, review count, delivery fee, offer, opening hours and badges. Read-only.",
      inputSchema: {
        location: location.optional(),
        category: category.optional(),
        min_rating: z.number().min(0).max(5).optional(),
        max_rating: z.number().min(0).max(5).optional(),
        min_reviews: z.number().int().min(0).optional(),
        max_reviews: z.number().int().min(0).optional(),
        min_price: z.number().int().min(0).optional().describe("Min INR price for one person (premium places)"),
        max_price: z.number().int().positive().optional().describe("Max INR price for one person"),
        veg_only: z.boolean().optional().describe("Only pure-veg restaurants"),
        cuisine: z.string().trim().min(2).max(40).optional().describe("Cuisine tag, e.g. Mughlai, Tibetan, Kebabs, Punjabi, Italian, Street Food"),
        max_cost_for_two: z.number().int().positive().optional().describe("Max INR cost for two people"),
        has_offer: z.boolean().optional().describe("Only restaurants with a current offer"),
        free_delivery: z.boolean().optional().describe("Only restaurants with no delivery fee"),
        sort_by: z
          .enum(["rating", "reviews", "reviews_asc", "price_asc", "price_desc", "delivery_time"])
          .default("rating"),
        limit,
      },
    },
    async (a) => {
      try {
        return json(
          await rpc("rpc_search_restaurants", {
            p_location: a.location ?? null,
            p_category: a.category ?? null,
            p_min_rating: a.min_rating ?? null,
            p_max_rating: a.max_rating ?? null,
            p_min_reviews: a.min_reviews ?? null,
            p_max_reviews: a.max_reviews ?? null,
            p_min_price: a.min_price ?? null,
            p_max_price: a.max_price ?? null,
            p_veg_only: a.veg_only ?? false,
            p_cuisine: a.cuisine ?? null,
            p_max_cost_for_two: a.max_cost_for_two ?? null,
            p_has_offer: a.has_offer ?? false,
            p_free_delivery: a.free_delivery ?? false,
            p_sort_by: a.sort_by,
            p_limit: a.limit,
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  reg("search_dishes", "dishes",
    {
      description:
        "Search dishes (open restaurants only) by location, category, veg flag, price range (use max_price for cheap items, min_price or sort_by price_desc for costly ones), min rating, spice level, bestsellers. Each row has the description, price and MRP discount, calories, serves, allergens, diet (veg, egg or non-veg), the dish rating and rating count, a recent review, and the restaurant rating and review count. Read-only.",
      inputSchema: {
        location: location.optional(),
        category: category.optional(),
        is_veg: z.boolean().optional().describe("true = veg only, false = non-veg only, omit = both"),
        min_price: z.number().int().min(0).optional().describe("Min dish price in INR (for costly items)"),
        max_price: z.number().int().positive().optional().describe("Max dish price in INR (e.g. 99 for 'under 100')"),
        min_rating: z.number().min(0).max(5).optional().describe("Min dish rating"),
        spice_level: z.enum(["mild", "medium", "hot"]).optional(),
        bestseller_only: z.boolean().optional(),
        max_calories: z.number().int().positive().optional().describe("Max calories per serving"),
        on_discount: z.boolean().optional().describe("Only dishes selling below their MRP"),
        avoid_allergens: z.array(ALLERGEN).optional().describe("Exclude dishes containing any of these"),
        sort_by: z.enum(["rating", "price_asc", "price_desc", "popularity", "calories_asc", "discount"]).default("rating"),
        limit,
      },
    },
    async (a) => {
      try {
        return json(
          await rpc("rpc_search_dishes", {
            p_location: a.location ?? null,
            p_category: a.category ?? null,
            p_is_veg: a.is_veg ?? null,
            p_min_price: a.min_price ?? null,
            p_max_price: a.max_price ?? null,
            p_min_rating: a.min_rating ?? null,
            p_spice_level: a.spice_level ?? null,
            p_bestseller_only: a.bestseller_only ?? false,
            p_max_calories: a.max_calories ?? null,
            p_on_discount: a.on_discount ?? false,
            p_avoid_allergens: a.avoid_allergens ?? null,
            p_sort_by: a.sort_by,
            p_limit: a.limit,
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  reg("best_dish_near_me", "dishes",
    {
      description:
        "Top-rated dishes within a radius of a point. Give lat+lng or a location name. If location or veg/non-veg preference is missing the server asks for it. Read-only.",
      inputSchema: {
        lat: z.number().min(-90).max(90).optional(),
        lng: z.number().min(-180).max(180).optional(),
        location: location.optional().describe("Used when lat/lng are not given"),
        radius_km: z.number().positive().max(50).default(3),
        is_veg: z
          .boolean()
          .optional()
          .describe("true = veg, false = non-veg. Omit only if the user wants both and said so"),
        min_price: z.number().int().min(0).optional().describe("Min dish price in INR"),
        max_price: z.number().int().positive().optional().describe("Max dish price in INR"),
        diet_any: z
          .boolean()
          .optional()
          .describe("Set true when the user explicitly wants both veg and non-veg"),
      },
    },
    async (a) => {
      try {
        const hasPoint = a.lat !== undefined && a.lng !== undefined;
        const missing: Field[] = [];
        if (!hasPoint && !a.location) missing.push("location");
        if (a.is_veg === undefined && !a.diet_any) missing.push("diet");
        const got = await ask(mcp, missing);
        if (isNeeds(got)) return json(got);

        const place = a.location ?? got.location;
        let lat = a.lat;
        let lng = a.lng;
        if (!hasPoint) {
          const c = await locationCoords(place!);
          lat = c.lat;
          lng = c.lng;
        }
        const diet = got.diet;
        const isVeg = a.is_veg ?? (diet === "veg" ? true : diet === "non-veg" ? false : null);

        return json(
          await rpc("rpc_best_dishes_near", {
            p_lat: lat,
            p_lng: lng,
            p_radius_km: a.radius_km,
            p_is_veg: isVeg,
            p_min_price: a.min_price ?? null,
            p_max_price: a.max_price ?? null,
            p_limit: DEFAULT_LIMIT,
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  reg("weak_restaurants", "restaurants",
    {
      description:
        "Restaurants with low rating and/or very few reviews. Provide max_rating and/or max_reviews; if neither is given the server asks for a review threshold. Read-only.",
      inputSchema: {
        location: location.optional(),
        max_rating: z.number().min(0).max(5).optional().describe("Include restaurants rated at or below this"),
        max_reviews: z.number().int().min(0).optional().describe("Include restaurants with at most this many reviews"),
      },
    },
    async (a) => {
      try {
        const missing: Field[] =
          a.max_rating === undefined && a.max_reviews === undefined ? ["review_threshold"] : [];
        const got = await ask(mcp, missing);
        if (isNeeds(got)) return json(got);
        return json(
          await rpc("rpc_weak_restaurants", {
            p_location: a.location ?? null,
            p_max_rating: a.max_rating ?? null,
            p_max_reviews: a.max_reviews ?? got.review_threshold ?? null,
            p_limit: DEFAULT_LIMIT,
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  reg("get_restaurant_details", "restaurant",
    {
      description:
        "Full restaurant page: cuisines, address, cost for two, delivery fee, packaging charge, minimum order, offer, opening hours, FSSAI licence, badges, then the menu by section. Each dish has description, price and MRP, calories, serves, allergens, rating, rating count and any reviews; the restaurant has rating, review count and its 5 most recent reviews. Set veg_only to hide non-veg dishes. Read-only.",
      inputSchema: {
        restaurant_id: z.number().int().positive(),
        veg_only: z.boolean().optional().describe("Only veg dishes in the menu"),
        min_price: z.number().int().min(0).optional(),
        max_price: z.number().int().positive().optional(),
      },
    },
    async ({ restaurant_id, veg_only, min_price, max_price }) => {
      try {
        let dq = db()
          .from("dishes")
          .select("id, name, description, menu_section, price, mrp, rating, rating_count, is_veg, is_egg, is_bestseller, is_must_try, spice_level, calories, serves, portion, allergens, prep_time_min, is_available")
          .eq("restaurant_id", restaurant_id);
        if (veg_only) dq = dq.eq("is_veg", true);
        if (min_price !== undefined) dq = dq.gte("price", min_price);
        if (max_price !== undefined) dq = dq.lte("price", max_price);
        const [r, d, v] = await Promise.all([
          db()
            .from("restaurants")
            .select(
              "id, name, avg_rating, review_count, price_for_one, cost_for_two, delivery_time_min, delivery_fee, packaging_charge, min_order_amount, offer_text, opens_at, closes_at, fssai_license, service_modes, badges, cuisines, address, is_pure_veg, is_open, categories(name), locations(name, city)",
            )
            .eq("id", restaurant_id)
            .maybeSingle(),
          dq.order("rating", { ascending: false }),
          db()
            .from("reviews")
            .select("dish_id, reviewer, rating, comment, created_at")
            .eq("restaurant_id", restaurant_id)
            .order("created_at", { ascending: false })
            .limit(50),
        ]);
        for (const x of [r, d, v]) if (x.error) throw new Error(x.error.message);
        if (!r.data) throw new Error(`Restaurant ${restaurant_id} not found`);
        const reviews = v.data ?? [];
        const menu = (d.data ?? []).map((dish) => ({
          ...dish,
          reviews: reviews
            .filter((x) => x.dish_id === dish.id)
            .map(({ reviewer, rating, comment }) => ({ reviewer, rating, comment })),
        }));
        return json({
          restaurant: r.data,
          menu,
          recent_reviews: reviews.slice(0, 5).map(({ reviewer, rating, comment, created_at }) => ({
            reviewer, rating, comment, created_at,
          })),
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  reg("find_dish", "dishes",
    {
      description:
        "Find a specific dish by name (partial match, e.g. 'paneer tikka', 'biryani') across open restaurants, with dish rating, rating count, a recent review, and the restaurant's rating and review count. Supports veg-only, price range, cheapest or costliest first. Read-only.",
      inputSchema: {
        query: z.string().trim().min(2).max(60).describe("Dish name or part of it"),
        location: location.optional(),
        is_veg: z.boolean().optional().describe("true = veg only, false = non-veg only"),
        min_price: z.number().int().min(0).optional().describe("Min dish price in INR (for costly items)"),
        max_price: z.number().int().positive().optional().describe("Max dish price in INR"),
        sort_by: z.enum(["rating", "price_asc", "price_desc"]).default("rating"),
        limit,
      },
    },
    async (a) => {
      try {
        return json(
          await rpc("rpc_search_dishes", {
            p_query: a.query,
            p_location: a.location ?? null,
            p_is_veg: a.is_veg ?? null,
            p_min_price: a.min_price ?? null,
            p_max_price: a.max_price ?? null,
            p_sort_by: a.sort_by,
            p_limit: a.limit,
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  reg("restaurants_near_me", "restaurants",
    {
      description:
        "Open restaurants within a radius of a point, nearest first. Give lat+lng or a location name; if neither is given the server asks for the location. Read-only.",
      inputSchema: {
        lat: z.number().min(-90).max(90).optional(),
        lng: z.number().min(-180).max(180).optional(),
        location: location.optional().describe("Used when lat/lng are not given"),
        radius_km: z.number().positive().max(50).default(3),
        category: category.optional(),
        min_rating: z.number().min(0).max(5).optional(),
        max_price: z.number().int().positive().optional().describe("Max INR price for one person"),
        veg_only: z.boolean().optional().describe("Only pure-veg restaurants"),
        limit,
      },
    },
    async (a) => {
      try {
        const hasPoint = a.lat !== undefined && a.lng !== undefined;
        const got = await ask(mcp, !hasPoint && !a.location ? ["location"] : []);
        if (isNeeds(got)) return json(got);
        let lat = a.lat;
        let lng = a.lng;
        if (!hasPoint) {
          const c = await locationCoords((a.location ?? got.location)!);
          lat = c.lat;
          lng = c.lng;
        }
        return json(
          await rpc("rpc_restaurants_near", {
            p_lat: lat,
            p_lng: lng,
            p_radius_km: a.radius_km,
            p_category: a.category ?? null,
            p_min_rating: a.min_rating ?? null,
            p_max_price: a.max_price ?? null,
            p_veg_only: a.veg_only ?? false,
            p_limit: a.limit,
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  reg("compare_restaurants", "compare",
    {
      description:
        "Side-by-side comparison of 2 to 4 restaurants (rating, reviews, price, cost for two, delivery time and fee, offer, hours, cuisines, veg, open) plus each one's top-rated dishes. Get ids from other tools. Read-only.",
      inputSchema: {
        restaurant_ids: z.array(z.number().int().positive()).min(2).max(4),
        veg_only: z.boolean().optional().describe("Only compare veg dishes"),
      },
    },
    async ({ restaurant_ids, veg_only }) => {
      try {
        const [r, d] = await Promise.all([
          db()
            .from("restaurants")
            .select(
              "id, name, avg_rating, review_count, price_for_one, cost_for_two, delivery_time_min, delivery_fee, packaging_charge, offer_text, opens_at, closes_at, cuisines, badges, is_pure_veg, is_open, categories(name), locations(name)",
            )
            .in("id", restaurant_ids),
          (veg_only
            ? db().from("dishes").select("restaurant_id, name, price, rating, rating_count, is_veg").in("restaurant_id", restaurant_ids).eq("is_veg", true)
            : db().from("dishes").select("restaurant_id, name, price, rating, rating_count, is_veg").in("restaurant_id", restaurant_ids)
          ).order("rating", { ascending: false }),
        ]);
        for (const x of [r, d]) if (x.error) throw new Error(x.error.message);
        const found = new Set((r.data ?? []).map((x) => x.id));
        const notFound = restaurant_ids.filter((id: number) => !found.has(id));
        const rows = (r.data ?? []).map((x) => ({
          ...x,
          top_dishes: (d.data ?? []).filter((y) => y.restaurant_id === x.id).slice(0, 3),
        }));
        return json({ restaurants: rows, ...(notFound.length ? { not_found: notFound } : {}) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  reg("get_reviews", "reviews",
    {
      description:
        "Customer reviews for one restaurant, newest first. Set max_rating (e.g. 2) to see complaints or min_rating (e.g. 4) to see praise. Read-only.",
      inputSchema: {
        restaurant_id: z.number().int().positive(),
        min_rating: z.number().int().min(1).max(5).optional(),
        max_rating: z.number().int().min(1).max(5).optional(),
        limit,
      },
    },
    async (a) => {
      try {
        let q = db()
          .from("reviews")
          .select("reviewer, rating, comment, created_at, dishes(name)")
          .eq("restaurant_id", a.restaurant_id);
        if (a.min_rating !== undefined) q = q.gte("rating", a.min_rating);
        if (a.max_rating !== undefined) q = q.lte("rating", a.max_rating);
        const { data, error } = await q.order("created_at", { ascending: false }).limit(a.limit);
        if (error) throw new Error(error.message);
        return json(data);
      } catch (e) {
        return fail(e);
      }
    },
  );

  reg("list_options", "options",
    {
      description:
        "Lists the supported locations (with city and coordinates), food categories, and the number of restaurants in each. Use first when unsure what can be searched. Read-only.",
      inputSchema: {},
    },
    async () => {
      try {
        const { data, error } = await db()
          .from("restaurants")
          .select("locations(name, city, lat, lng), categories(name)");
        if (error) throw new Error(error.message);
        const locs = new Map<string, { name: string; city: string; lat: number; lng: number; restaurants: number }>();
        const cats = new Map<string, number>();
        for (const row of (data ?? []) as unknown as {
          locations: { name: string; city: string; lat: number; lng: number };
          categories: { name: string };
        }[]) {
          const l = locs.get(row.locations.name) ?? { ...row.locations, restaurants: 0 };
          l.restaurants++;
          locs.set(row.locations.name, l);
          cats.set(row.categories.name, (cats.get(row.categories.name) ?? 0) + 1);
        }
        return json({
          locations: [...locs.values()],
          categories: [...cats].map(([name, restaurants]) => ({ name, restaurants })),
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  reg(
    "get_dish_details",
    "dish",
    {
      description:
        "Details for one dish: description, price and MRP discount, calories, serves, portion, allergens, prep time, diet (veg, egg or non-veg), spice level, rating, rating count, its restaurant (rating, review count, delivery fee, offer) and the dish's reviews. Read-only.",
      inputSchema: { dish_id: z.number().int().positive() },
    },
    async ({ dish_id }: { dish_id: number }) => {
      try {
        const { data: d, error } = await db()
          .from("menu_items")
          .select(
            "dish_id, dish_name, is_veg, dish_price, dish_rating, dish_rating_count, is_bestseller, spice_level, restaurant_id, restaurant_name, restaurant_rating, restaurant_review_count, price_for_one, delivery_time_min, is_open, category, location, city",
          )
          .eq("dish_id", dish_id)
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!d) throw new Error(`Dish ${dish_id} not found`);
        const { data: rv, error: e2 } = await db()
          .from("reviews")
          .select("reviewer, rating, comment, created_at")
          .eq("dish_id", dish_id)
          .order("created_at", { ascending: false })
          .limit(10);
        if (e2) throw new Error(e2.message);
        const [{ data: x, error: e3 }, { data: rest, error: e4 }] = await Promise.all([
          db().from("dishes").select("description, menu_section, is_egg, mrp, serves, portion, calories, allergens, prep_time_min, is_available, is_must_try").eq("id", dish_id).maybeSingle(),
          db().from("restaurants").select("delivery_fee, packaging_charge, min_order_amount, offer_text, opens_at, closes_at").eq("id", d.restaurant_id).maybeSingle(),
        ]);
        if (e3 || e4) throw new Error((e3 ?? e4)!.message);
        const dish = {
          ...d, ...x, ...rest,
          diet: d.is_veg ? "veg" : x?.is_egg ? "egg" : "non-veg",
          discount_percent: x?.mrp && x.mrp > d.dish_price ? Math.round(((x.mrp - d.dish_price) * 100) / x.mrp) : null,
        };
        return json({ dish, reviews: rv });
      } catch (e) {
        return fail(e);
      }
    },
  );

  reg("restaurant_offers", "restaurants",
    {
      description:
        "Restaurants with a current offer or discount, optionally only those with free delivery. Use for deals, coupons, discounts, offers, free delivery. Read-only.",
      inputSchema: {
        location: location.optional(),
        category: category.optional(),
        veg_only: z.boolean().optional().describe("Only pure-veg restaurants"),
        free_delivery: z.boolean().optional().describe("Only restaurants with no delivery fee"),
        min_rating: z.number().min(0).max(5).optional(),
        limit,
      },
    },
    async (a) => {
      try {
        return json(
          await rpc("rpc_search_restaurants", {
            p_location: a.location ?? null,
            p_category: a.category ?? null,
            p_min_rating: a.min_rating ?? null,
            p_veg_only: a.veg_only ?? false,
            p_has_offer: !a.free_delivery,
            p_free_delivery: a.free_delivery ?? false,
            p_sort_by: "rating",
            p_limit: a.limit,
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  reg("dish_deals", "dishes",
    {
      description:
        "Dishes selling below their MRP, biggest discount first. Use for deals, discounts, best value, cheap bites. Read-only.",
      inputSchema: {
        location: location.optional(),
        category: category.optional(),
        is_veg: z.boolean().optional().describe("true = veg only, false = non-veg only"),
        min_price: z.number().int().min(0).optional().describe("Min dish price in INR"),
        max_price: z.number().int().positive().optional().describe("Max dish price in INR"),
        min_rating: z.number().min(0).max(5).optional(),
        limit,
      },
    },
    async (a) => {
      try {
        return json(
          await rpc("rpc_search_dishes", {
            p_location: a.location ?? null,
            p_category: a.category ?? null,
            p_is_veg: a.is_veg ?? null,
            p_min_price: a.min_price ?? null,
            p_max_price: a.max_price ?? null,
            p_min_rating: a.min_rating ?? null,
            p_on_discount: true,
            p_sort_by: "discount",
            p_limit: a.limit,
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  reg("dietary_search", "dishes",
    {
      description:
        "Dishes that fit a dietary need: low calorie or healthy (max_calories), and free of allergens such as gluten, dairy, egg, nuts, peanuts, soy, fish or sesame. Use for 'healthy', 'light', 'under 400 calories', 'dairy free', 'gluten free', 'nut allergy'. Read-only.",
      inputSchema: {
        location: location.optional(),
        category: category.optional(),
        is_veg: z.boolean().optional().describe("true = veg only, false = non-veg only"),
        max_calories: z.number().int().positive().optional().describe("Max calories per serving"),
        avoid_allergens: z.array(ALLERGEN).optional().describe("Exclude dishes containing any of these"),
        min_price: z.number().int().min(0).optional().describe("Min dish price in INR"),
        max_price: z.number().int().positive().optional().describe("Max dish price in INR"),
        sort_by: z.enum(["rating", "calories_asc"]).default("rating"),
        limit,
      },
    },
    async (a) => {
      try {
        return json(
          await rpc("rpc_search_dishes", {
            p_location: a.location ?? null,
            p_category: a.category ?? null,
            p_is_veg: a.is_veg ?? null,
            p_min_price: a.min_price ?? null,
            p_max_price: a.max_price ?? null,
            p_max_calories: a.max_calories ?? null,
            p_avoid_allergens: a.avoid_allergens ?? null,
            p_sort_by: a.sort_by,
            p_limit: a.limit,
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  reg("open_now", "restaurants",
    {
      description:
        "Restaurants open right now (India time) or at a given time, best rated first. Use for 'open now', 'open late', 'open at 11 pm', 'breakfast places'. Read-only.",
      inputSchema: {
        location: location.optional(),
        category: category.optional(),
        at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().describe("24-hour time HH:MM in India time; omit for right now"),
        limit,
      },
    },
    async (a) => {
      try {
        return json(
          await rpc("rpc_open_restaurants", {
            p_location: a.location ?? null,
            p_category: a.category ?? null,
            p_at: a.at ?? null,
            p_limit: a.limit,
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  reg("estimate_order", "bill",
    {
      description:
        "Price an order: item total, packaging charge, delivery fee, 5% GST and grand total, plus whether the restaurant's minimum order is met. All dishes must be from one restaurant. Use for 'how much will this cost', 'bill for 2 masala dosa and a coffee'. Read-only; nothing is ordered.",
      inputSchema: {
        items: z
          .array(z.object({ dish_id: z.number().int().positive(), quantity: z.number().int().min(1).max(20).default(1) }))
          .min(1)
          .max(15),
      },
    },
    async ({ items }: { items: { dish_id: number; quantity: number }[] }) => {
      try {
        const ids = [...new Set(items.map((i) => i.dish_id))];
        const { data, error } = await db()
          .from("dishes")
          .select(
            "id, name, price, is_veg, is_available, restaurant_id, restaurants(id, name, packaging_charge, delivery_fee, min_order_amount, offer_text, delivery_time_min, is_open)",
          )
          .in("id", ids);
        if (error) throw new Error(error.message);
        type Row = {
          id: number; name: string; price: number; is_veg: boolean; is_available: boolean; restaurant_id: number;
          restaurants: { id: number; name: string; packaging_charge: number; delivery_fee: number; min_order_amount: number; offer_text: string | null; delivery_time_min: number; is_open: boolean };
        };
        const rows = (data ?? []) as unknown as Row[];
        const missing = ids.filter((id) => !rows.some((r) => r.id === id));
        if (missing.length) throw new Error(`Dish not found: ${missing.join(", ")}`);
        const rids = new Set(rows.map((r) => r.restaurant_id));
        if (rids.size > 1) throw new Error("These dishes are from different restaurants. Pick dishes from one restaurant per order.");
        const rest = rows[0].restaurants;
        const unavailable = rows.filter((r) => !r.is_available).map((r) => r.name);
        const lines = items.map((i) => {
          const d = rows.find((r) => r.id === i.dish_id)!;
          return { dish_id: d.id, name: d.name, is_veg: d.is_veg, quantity: i.quantity, unit_price: d.price, line_total: d.price * i.quantity };
        });
        const itemTotal = lines.reduce((t, l) => t + l.line_total, 0);
        const gst = Math.round(itemTotal * 0.05);
        const total = itemTotal + rest.packaging_charge + rest.delivery_fee + gst;
        const notes = ["Platform fee and coupons are not included."];
        if (rest.offer_text) notes.push(`Restaurant offer (not applied): ${rest.offer_text}.`);
        if (!rest.is_open) notes.push("This restaurant is currently closed.");
        if (unavailable.length) notes.push(`Currently unavailable: ${unavailable.join(", ")}.`);
        return json({
          restaurant: { id: rest.id, name: rest.name, delivery_time_min: rest.delivery_time_min, is_open: rest.is_open },
          lines,
          bill: { item_total: itemTotal, packaging_charge: rest.packaging_charge, delivery_fee: rest.delivery_fee, gst_5_percent: gst, total },
          minimum_order: { amount: rest.min_order_amount, met: itemTotal >= rest.min_order_amount, short_by: Math.max(0, rest.min_order_amount - itemTotal) },
          notes,
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  reg("meal_for_budget", "meals",
    {
      description:
        "Suggest complete meals for a number of people within a total budget in INR, using well-rated restaurants in an area. Each suggestion lists the dishes and the full bill (items, packaging, delivery, GST). Use for 'dinner for 2 under 500', 'lunch for 4 with 800 rupees'. If the area is missing the server asks for it. Read-only.",
      inputSchema: {
        people: z.number().int().min(1).max(8).default(2),
        budget: z.number().int().min(100).max(10000).describe("Total budget in INR including fees and tax"),
        location: location.optional(),
        is_veg: z.boolean().optional().describe("true = veg only"),
      },
    },
    async (a) => {
      try {
        const got = await ask(mcp, !a.location ? ["location"] : []);
        if (isNeeds(got)) return json(got);
        const place = a.location ?? got.location!;
        const rests = ((await rpc("rpc_search_restaurants", { p_location: place, p_sort_by: "rating", p_limit: 25 })) as {
          restaurant_id: number; name: string; rating: number; review_count: number; delivery_fee: number; packaging_charge: number; is_open: boolean; delivery_time_min: number;
        }[]).filter((r) => r.is_open && r.review_count >= 30);
        if (!rests.length) return json([]);
        let dq = db()
          .from("dishes")
          .select("id, name, price, rating, is_veg, menu_section, restaurant_id")
          .in("restaurant_id", rests.map((r) => r.restaurant_id))
          .eq("is_available", true);
        if (a.is_veg) dq = dq.eq("is_veg", true);
        const { data: dishes, error } = await dq;
        if (error) throw new Error(error.message);
        const MAIN = new Set(["Burgers", "Pizzas", "Biryani", "Dosas", "Meals", "Mains", "Noodles & Rice", "Rolls", "Parathas", "Steamed Momos", "Fried Momos", "Tandoori Momos", "Chaat", "Snacks", "Idli & Vada", "Rice"]);
        const EXTRA = new Set(["Desserts", "Beverages", "Sides", "Starters", "Soups"]);
        type D = { id: number; name: string; price: number; rating: number; is_veg: boolean; menu_section: string; restaurant_id: number };
        const all = (dishes ?? []) as D[];
        const combos = [];
        for (const r of rests) {
          const mine = all.filter((d) => d.restaurant_id === r.restaurant_id);
          const mains = mine.filter((d) => MAIN.has(d.menu_section)).sort((x, y) => y.rating - x.rating || x.price - y.price);
          const extras = mine.filter((d) => EXTRA.has(d.menu_section)).sort((x, y) => y.rating - x.rating || x.price - y.price);
          if (!mains.length) continue;
          const fixed = r.delivery_fee + r.packaging_charge;
          const room = (a.budget - fixed) / 1.05; // item total allowed before 5% GST
          const cheapest = Math.min(...mains.map((d) => d.price));
          const picked: D[] = [];
          let sum = 0;
          for (let n = 0; n < a.people; n++) {
            const left = a.people - n - 1;
            const pick = mains.find((d) => (picked.filter((p) => p.id === d.id).length === 0 || mains.length <= n) && sum + d.price + left * cheapest <= room);
            if (!pick) break;
            picked.push(pick); sum += pick.price;
          }
          if (picked.length < a.people) continue;
          for (const e of extras) {
            if (picked.filter((p) => EXTRA.has(p.menu_section)).length >= Math.ceil(a.people / 2)) break;
            if (!picked.some((p) => p.id === e.id) && sum + e.price <= room) { picked.push(e); sum += e.price; }
          }
          const lines = [...new Map(picked.map((p) => [p.id, p])).values()].map((d) => {
            const qty = picked.filter((p) => p.id === d.id).length;
            return { dish_id: d.id, name: d.name, is_veg: d.is_veg, quantity: qty, unit_price: d.price, line_total: d.price * qty };
          });
          const gst = Math.round(sum * 0.05);
          const total = sum + fixed + gst;
          if (total > a.budget) continue;
          const score = r.rating * 10 + lines.reduce((t, l) => t + (all.find((d) => d.id === l.dish_id)?.rating ?? 0), 0) / lines.length;
          combos.push({
            score,
            restaurant: { id: r.restaurant_id, name: r.name, rating: r.rating, review_count: r.review_count, delivery_time_min: r.delivery_time_min },
            lines,
            bill: { item_total: sum, packaging_charge: r.packaging_charge, delivery_fee: r.delivery_fee, gst_5_percent: gst, total },
            budget_left: a.budget - total,
          });
        }
        combos.sort((x, y) => y.score - x.score);
        return json(combos.slice(0, 3).map(({ score: _s, ...c }) => ({ ...c, people: a.people, budget: a.budget })));
      } catch (e) {
        return fail(e);
      }
    },
  );
}
