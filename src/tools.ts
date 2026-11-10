import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CATEGORIES, DEFAULT_LIMIT, LOCATIONS, MAX_LIMIT } from "./config.js";
import { db } from "./db.js";
import { ask, isNeeds, type Field } from "./elicit.js";

const location = z.enum(LOCATIONS).describe("Area name");
const category = z.enum(CATEGORIES).describe("Food category");
// Accepts a restaurant id, or a name (optionally with an area) and returns the id.
// If a name exists in several areas, the most-reviewed one wins and the others are listed in also_in.
async function resolveRestaurant(a: { restaurant_id?: number; restaurant_name?: string; location?: string }): Promise<{ id: number; also_in: string[] }> {
  if (a.restaurant_id) return { id: a.restaurant_id, also_in: [] };
  if (!a.restaurant_name) throw new Error("Give a restaurant_id or a restaurant_name.");
  const term = a.restaurant_name.replace(/[\\%_]/g, "\\$&");
  let q = db().from("restaurants").select("id, name, review_count, locations!inner(name)").ilike("name", `%${term}%`);
  if (a.location) q = q.ilike("locations.name", a.location);
  const { data, error } = await q.order("review_count", { ascending: false }).limit(10);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as { id: number; name: string; review_count: number; locations: { name: string } }[];
  if (!rows.length) {
    if (a.location) {
      const { data: any_ } = await db().from("restaurants").select("name, locations!inner(name)").ilike("name", `%${term}%`).limit(10);
      const where = [...new Set(((any_ ?? []) as unknown as { locations: { name: string } }[]).map((r) => r.locations.name))];
      if (where.length) throw new Error(`No restaurant matching "${a.restaurant_name}" in ${a.location}. A restaurant with that name exists in: ${where.join(", ")}.`);
    }
    throw new Error(`No restaurant matching "${a.restaurant_name}"${a.location ? ` in ${a.location}` : ""}. Use search_restaurants to look for it.`);
  }
  const exact = rows.filter((r) => r.name.toLowerCase() === a.restaurant_name!.toLowerCase());
  const pool = exact.length ? exact : rows;
  return { id: pool[0].id, also_in: pool.slice(1).map((r) => r.locations.name) };
}

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

const UI_TOOLS = new Set(["search_restaurants","search_dishes","best_dish_near_me","weak_restaurants","get_restaurant_details","find_dish","restaurants_near_me","compare_restaurants","get_dish_details","restaurant_offers","dish_deals","dietary_search","open_now","estimate_order","meal_for_budget","get_reviews","list_options","suggest_food"]);
// Short version of a result for the model. The card gets the full data.
/* eslint-disable @typescript-eslint/no-explicit-any */
function digest(view: string, data: any): unknown {
  const pick = (o: any, keys: string[]) => Object.fromEntries(keys.filter((k) => o?.[k] != null).map((k) => [k, o[k]]));
  switch (view) {
    case "dishes":
      return { count: data.length, items: data.map((d: any) => pick(d, ["dish_id", "dish", "restaurant", "price", "rating", "diet", "calories", "discount_percent", "distance_km"])) };
    case "restaurants":
      return { count: data.length, items: data.map((r: any) => pick(r, ["restaurant_id", "name", "location", "rating", "review_count", "cost_for_two", "price_for_one", "delivery_fee", "offer", "opens", "closes", "distance_km"])) };
    case "restaurant":
      return { id: data.restaurant.id, name: data.restaurant.name, ...(data.also_in ? { also_in_areas: data.also_in } : {}), rating: data.restaurant.avg_rating, menu_items: data.menu.length, sample_dishes: data.menu.slice(0, 5).map((m: any) => pick(m, ["id", "name", "price", "rating"])) };
    case "dish":
      return pick(data.dish, ["dish_id", "dish_name", "dish_price", "dish_rating", "restaurant_id", "restaurant_name", "calories", "diet"]);
    case "compare":
      return { restaurants: data.restaurants.map((r: any) => pick(r, ["id", "name", "avg_rating", "review_count", "cost_for_two", "delivery_time_min", "delivery_fee", "offer_text"])) };
    case "reviews":
      return { count: data.length, average: data.length ? +(data.reduce((t: number, x: any) => t + x.rating, 0) / data.length).toFixed(1) : null };
    case "options":
      return { ...(data.summary ? { summary: data.summary } : {}), total_restaurants: data.total_restaurants, per_area: data.locations.map((l: any) => ({ area: l.name, restaurants: l.restaurants, average_rating: l.average_rating, average_cost_for_two: l.average_cost_for_two })), cuisines: (data.cuisines ?? []).map((c: any) => c.name), categories: data.categories.map((c: any) => ({ name: c.name, restaurants: c.restaurants })) };
    default:
      return data; // bill and meals are already compact
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export const UI_URI = "ui://qsr/app.html";
export const UI_MIME = "text/html;profile=mcp-app";

const PREFIX = "QSR Food Finder: ";
const SUFFIX =
  " This is the user's own restaurant database for Delhi NCR (Connaught Place, Hauz Khas, Saket, Karol Bagh, Lajpat Nagar, Dwarka, Cyber Hub, Golf Course Road, Sector 62, Sector 18, Indirapuram, Gaur City, Sector 15). Any question about restaurants, dishes, menus, prices, offers, delivery or how many restaurants are in those areas refers to this data, so use this tool instead of web search or general knowledge.";
const CARD = " The result is shown to the user as an interactive card: never list or retell the results in your reply.";
const TITLES: Record<string, string> = {
  search_restaurants: "Find restaurants", search_dishes: "Find dishes", best_dish_near_me: "Best dishes near me", weak_restaurants: "Weakly rated restaurants",
  get_restaurant_details: "Restaurant page and menu", find_dish: "Find a dish by name", restaurants_near_me: "Restaurants near me", compare_restaurants: "Compare restaurants",
  get_reviews: "Restaurant reviews", list_options: "Counts and area overview", get_dish_details: "Dish details", restaurant_offers: "Offers and free delivery",
  dish_deals: "Dish deals", dietary_search: "Healthy and allergen-free dishes", open_now: "Open now or at a time", estimate_order: "Order bill estimate",
  meal_for_budget: "Meal for a budget", suggest_food: "What should I eat",
};
const EXAMPLES: Record<string, string> = {
  search_restaurants: "Use for: best pizza places in Saket, restaurants, cafes, eateries, joints or dhabas in an area, a restaurant by name (Burger Barn), pure veg restaurants, Mughlai restaurants under 500 for two, new restaurants, cheapest or most expensive restaurants, fastest delivery.",
  search_dishes: "Use for: veg dishes under 100, costliest biryani, spicy bestsellers, popular or most ordered dishes, mild dishes, non-veg under 200, dishes under 400 calories, a category like momos or pizza in an area.",
  best_dish_near_me: "Use for: best dish near Hauz Khas, top veg dish near me.",
  weak_restaurants: "Use for: worst rated restaurants, places with few reviews.",
  get_restaurant_details: "Use for: tell me about a restaurant by name (Dosa Dhaba), show its menu, what does it serve, is it open, its address, hours, delivery fee, minimum order, FSSAI licence.",
  find_dish: "Use for: where can I get paneer tikka roll, cheapest masala dosa.",
  restaurants_near_me: "Use for: restaurants near Cyber Hub, places within 2 km.",
  compare_restaurants: "Use for: compare X and Y by name, which is better value, X vs Y.",
  get_reviews: "Use for: reviews of a restaurant by name, what do people say, complaints, 5-star reviews, is it good.",
  list_options: "Use for: how many restaurants are in Gaur City (or any area), how many places do you have, what areas and cuisines do you cover, an overview of an area.",
  get_dish_details: "Use for: tell me about this dish, calories, allergens, ingredients.",
  restaurant_offers: "Use for: offers, discounts, coupons, free delivery.",
  dish_deals: "Use for: deals on dishes, discounted food, best value.",
  dietary_search: "Use for: healthy, low calorie, gluten free, dairy free, nut allergy.",
  open_now: "Use for: open now, open late, open at 11 pm, breakfast places.",
  estimate_order: "Use for: how much will this order cost, bill for 2 masala dosas and a filter coffee at Madras Cafe Co, total with delivery and GST. Works with dish and restaurant names.",
  meal_for_budget: "Use for: dinner for 2 under 500, lunch for 4 within 800 rupees, party budget meal.",
  suggest_food: "Use for: what should I eat, I am hungry, suggest dinner, breakfast ideas, snack, dessert, late-night food, surprise me.",
};

export function registerTools(mcp: McpServer): void {
  // Every tool description says when to use it, so the model picks these tools unprompted.
  const register = mcp.registerTool.bind(mcp) as (n: string, c: { description?: string }, h: unknown) => unknown;
  (mcp as unknown as { registerTool: typeof register }).registerTool = (n, c, h) =>
    register(
      n,
      {
        ...c,
        title: TITLES[n],
        description: PREFIX + (c.description ?? "") + " " + (EXAMPLES[n] ?? "") + SUFFIX + (UI_TOOLS.has(n) ? CARD : ""),
        // Read-only, closed domain: hosts can run these without a permission prompt.
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      } as { description?: string },
      h,
    );

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
          "STOP: the user already sees all of this in an interactive card. Do NOT list, table, summarise or retell these items. Reply with at most one short sentence (one recommendation, a caveat, or a follow-up question), or nothing. Digest for your own reasoning only: ";
        return {
          content: [{ type: "text" as const, text: note + JSON.stringify(digest(view, data)) }],
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
        name: z.string().trim().min(2).max(60).optional().describe("Restaurant name or part of it, e.g. Burger Barn"),
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
            p_name: a.name ?? null,
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
        restaurant_id: z.number().int().positive().optional(),
        restaurant_name: z.string().trim().min(2).max(60).optional().describe("Restaurant name, e.g. Dosa Dhaba (use instead of the id)"),
        location: location.optional().describe("Area, to pick the right branch when a name exists in several areas"),
        veg_only: z.boolean().optional().describe("Only veg dishes in the menu"),
        min_price: z.number().int().min(0).optional(),
        max_price: z.number().int().positive().optional(),
      },
    },
    async (a0) => {
      try {
        const { id: restaurant_id, also_in } = await resolveRestaurant(a0);
        a0.restaurant_id = restaurant_id;
        const { veg_only, min_price, max_price } = a0;
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
          ...(also_in.length ? { also_in } : {}),
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
        restaurant_ids: z.array(z.number().int().positive()).min(2).max(4).optional(),
        restaurant_names: z.array(z.string().trim().min(2).max(60)).min(2).max(4).optional().describe("Restaurant names (use instead of ids)"),
        location: location.optional().describe("Area, to pick the right branch of each name"),
        veg_only: z.boolean().optional().describe("Only compare veg dishes"),
      },
    },
    async (a0) => {
      try {
        const veg_only = a0.veg_only;
        const restaurant_ids: number[] = [...new Set<number>(
          a0.restaurant_ids ?? (await Promise.all((a0.restaurant_names ?? []).map((n: string) => resolveRestaurant({ restaurant_name: n, location: a0.location })))).map((r) => r.id),
        )];
        if (restaurant_ids.length < 2) throw new Error("Give 2 to 4 different restaurants (ids or names).");
        a0.restaurant_ids = restaurant_ids;
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
        restaurant_id: z.number().int().positive().optional(),
        restaurant_name: z.string().trim().min(2).max(60).optional().describe("Restaurant name (use instead of the id)"),
        location: location.optional().describe("Area, to pick the right branch"),
        min_rating: z.number().int().min(1).max(5).optional(),
        max_rating: z.number().int().min(1).max(5).optional(),
        limit,
      },
    },
    async (a) => {
      try {
        const { id } = await resolveRestaurant(a);
        a.restaurant_id = id;
        let q = db()
          .from("reviews")
          .select("reviewer, rating, comment, created_at, dishes(name)")
          .eq("restaurant_id", id);
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
        "Counts and overview: how many restaurants there are in an area, in each area, in each food type and cuisine, which area has the best average rating or lowest cost, plus the supported areas and categories. Pass location for one area's overview (restaurant count, average rating, price range for two, pure-veg places, places with offers or free delivery, food types). Read-only.",
      inputSchema: { location: location.optional().describe("Area for a single-area overview") },
    },
    async (a) => {
      try {
        let q = db()
          .from("restaurants")
          .select(
            "avg_rating, cost_for_two, is_pure_veg, is_open, offer_text, delivery_fee, cuisines, locations!inner(name, city, lat, lng), categories(name)",
          );
        if (a.location) q = q.ilike("locations.name", a.location);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        type Row = {
          avg_rating: number; cost_for_two: number | null; is_pure_veg: boolean; is_open: boolean; offer_text: string | null; delivery_fee: number | null; cuisines: string[] | null;
          locations: { name: string; city: string; lat: number; lng: number }; categories: { name: string };
        };
        const rows = (data ?? []) as unknown as Row[];
        const locs = new Map<string, { name: string; city: string; lat: number; lng: number; restaurants: number; rating_sum: number; cost_sum: number }>();
        const cats = new Map<string, number>();
        const cuis = new Map<string, number>();
        for (const row of rows) {
          const l = locs.get(row.locations.name) ?? { ...row.locations, restaurants: 0, rating_sum: 0, cost_sum: 0 };
          l.restaurants++;
          l.rating_sum += row.avg_rating;
          l.cost_sum += row.cost_for_two ?? 0;
          locs.set(row.locations.name, l);
          cats.set(row.categories.name, (cats.get(row.categories.name) ?? 0) + 1);
          for (const c of row.cuisines ?? []) cuis.set(c, (cuis.get(c) ?? 0) + 1);
        }
        const costs = rows.map((r) => r.cost_for_two).filter((c): c is number => c != null);
        const summary = a.location
          ? {
              area: a.location,
              city: rows[0]?.locations.city ?? null,
              restaurants: rows.length,
              marked_open: rows.filter((r) => r.is_open).length,
              average_rating: rows.length ? Math.round((rows.reduce((t, r) => t + r.avg_rating, 0) / rows.length) * 10) / 10 : null,
              cost_for_two_min: costs.length ? Math.min(...costs) : null,
              cost_for_two_max: costs.length ? Math.max(...costs) : null,
              pure_veg: rows.filter((r) => r.is_pure_veg).length,
              with_offers: rows.filter((r) => r.offer_text).length,
              free_delivery: rows.filter((r) => r.delivery_fee === 0).length,
            }
          : null;
        return json({
          ...(summary ? { summary } : {}),
          total_restaurants: rows.length,
          locations: [...locs.values()].map(({ rating_sum, cost_sum, ...l }) => ({
            ...l,
            average_rating: Math.round((rating_sum / l.restaurants) * 10) / 10,
            average_cost_for_two: Math.round(cost_sum / l.restaurants),
          })),
          categories: [...cats].map(([name, restaurants]) => ({ name, restaurants })),
          cuisines: [...cuis].sort((x, y) => y[1] - x[1]).map(([name, restaurants]) => ({ name, restaurants })),
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
        "Price an order: item total, packaging charge, delivery fee, 5% GST and grand total, plus whether the restaurant's minimum order is met. All dishes must be from one restaurant. Identify dishes by dish_id or by dish_name together with the restaurant (restaurant_id, or restaurant_name and optionally location). Read-only; nothing is ordered.",
      inputSchema: {
        restaurant_id: z.number().int().positive().optional(),
        restaurant_name: z.string().trim().min(2).max(60).optional().describe("Restaurant name, e.g. Madras Cafe Co"),
        location: location.optional().describe("Area, to pick the right branch"),
        items: z
          .array(
            z.object({
              dish_id: z.number().int().positive().optional(),
              dish_name: z.string().trim().min(2).max(60).optional().describe("Dish name, e.g. Masala Dosa"),
              quantity: z.number().int().min(1).max(20).default(1),
            }),
          )
          .min(1)
          .max(15),
      },
    },
    async (a: { restaurant_id?: number; restaurant_name?: string; location?: string; items: { dish_id?: number; dish_name?: string; quantity: number }[] }) => {
      try {
        const ctx = a.restaurant_id || a.restaurant_name ? await resolveRestaurant(a) : null;
        const select =
          "id, name, price, is_veg, is_available, restaurant_id, restaurants(id, name, packaging_charge, delivery_fee, min_order_amount, offer_text, delivery_time_min, is_open)";
        type Row = {
          id: number; name: string; price: number; is_veg: boolean; is_available: boolean; restaurant_id: number;
          restaurants: { id: number; name: string; packaging_charge: number; delivery_fee: number; min_order_amount: number; offer_text: string | null; delivery_time_min: number; is_open: boolean };
        };
        const resolved: { row: Row; quantity: number }[] = [];
        for (const it of a.items) {
          if (!it.dish_id && !it.dish_name) throw new Error("Each item needs a dish_id or a dish_name.");
          let q = db().from("dishes").select(select);
          if (it.dish_id) q = q.eq("id", it.dish_id);
          else {
            if (!ctx) throw new Error("To order by dish name, also give the restaurant_name (and location if the name is in several areas).");
            const term = it.dish_name!.replace(/[\\%_]/g, "\\$&");
            q = q.eq("restaurant_id", ctx.id).ilike("name", `%${term}%`);
          }
          const { data, error } = await q.order("rating", { ascending: false }).limit(10);
          if (error) throw new Error(error.message);
          const found = (data ?? []) as unknown as Row[];
          if (!found.length) throw new Error(it.dish_id ? `Dish not found: ${it.dish_id}` : `No dish matching "${it.dish_name}" at that restaurant. Use get_restaurant_details to see the menu.`);
          const exact = found.find((r) => r.name.toLowerCase() === (it.dish_name ?? "").toLowerCase());
          resolved.push({ row: exact ?? found[0], quantity: it.quantity });
        }
        const rids = new Set(resolved.map((r) => r.row.restaurant_id));
        if (rids.size > 1) throw new Error("These dishes are from different restaurants. Pick dishes from one restaurant per order.");
        const rest = resolved[0].row.restaurants;
        const merged = new Map<number, { row: Row; quantity: number }>();
        for (const r of resolved) merged.set(r.row.id, { row: r.row, quantity: (merged.get(r.row.id)?.quantity ?? 0) + r.quantity });
        const lines = [...merged.values()].map(({ row: d, quantity }) => ({
          dish_id: d.id, name: d.name, is_veg: d.is_veg, quantity, unit_price: d.price, line_total: d.price * quantity,
        }));
        const unavailable = [...merged.values()].filter((m) => !m.row.is_available).map((m) => m.row.name);
        const itemTotal = lines.reduce((t, l) => t + l.line_total, 0);
        const gst = Math.round(itemTotal * 0.05);
        const total = itemTotal + rest.packaging_charge + rest.delivery_fee + gst;
        const notes = ["Platform fee and coupons are not included."];
        if (rest.offer_text) notes.push(`Restaurant offer (not applied): ${rest.offer_text}.`);
        if (!rest.is_open) notes.push("This restaurant is currently closed.");
        if (unavailable.length) notes.push(`Currently unavailable: ${unavailable.join(", ")}.`);
        if (ctx?.also_in.length) notes.push(`Priced at the most-reviewed branch. The same name also exists in: ${ctx.also_in.join(", ")}.`);
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

  reg("suggest_food", "dishes",
    {
      description:
        "Suggest what to eat for a moment of the day or a mood: breakfast, lunch, dinner, snack, dessert, late-night or party food. Returns top-rated dishes from fitting food types, optionally veg only, under a price, in an area. Use when the user is hungry or undecided. Read-only.",
      inputSchema: {
        occasion: z.enum(["breakfast", "lunch", "dinner", "snack", "dessert", "late-night", "party"]).default("dinner"),
        location: location.optional(),
        is_veg: z.boolean().optional().describe("true = veg only, false = non-veg only"),
        min_price: z.number().int().min(0).optional().describe("Min dish price in INR"),
        max_price: z.number().int().positive().optional().describe("Max dish price in INR"),
        limit,
      },
    },
    async (a) => {
      try {
        const PLAN: Record<string, string[]> = {
          breakfast: ["South Indian", "North Indian Meals", "Chaat & Snacks"],
          lunch: ["North Indian Meals", "Biryani", "South Indian", "Chinese"],
          dinner: ["Biryani", "North Indian Meals", "Pizza", "Chinese"],
          snack: ["Momos", "Chaat & Snacks", "Burgers", "Rolls & Wraps"],
          dessert: ["Desserts & Beverages"],
          "late-night": ["Burgers", "Pizza", "Rolls & Wraps", "Momos", "Biryani"],
          party: ["Pizza", "Biryani", "Chinese", "Burgers"],
        };
        const batches = await Promise.all(
          PLAN[a.occasion].map((c) =>
            rpc("rpc_search_dishes", {
              p_location: a.location ?? null,
              p_category: c,
              p_is_veg: a.is_veg ?? null,
              p_min_price: a.min_price ?? null,
              p_max_price: a.max_price ?? null,
              p_min_rating: 4,
              p_sort_by: "rating",
              p_limit: 12,
            }),
          ),
        );
        const rows = (batches.flat() as { dish_id: number; rating: number; rating_count: number }[])
          .sort((x, y) => y.rating - x.rating || y.rating_count - x.rating_count)
          .filter((r, i, all) => all.findIndex((o) => o.dish_id === r.dish_id) === i)
          .slice(0, a.limit);
        return json(rows);
      } catch (e) {
        return fail(e);
      }
    },
  );
}
