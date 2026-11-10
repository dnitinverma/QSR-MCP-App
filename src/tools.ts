import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CATEGORIES, DEFAULT_LIMIT, LOCATIONS, MAX_LIMIT } from "./config.js";
import { db } from "./db.js";
import { ask, isNeeds, type Field } from "./elicit.js";

const location = z.enum(LOCATIONS).describe("Area name");
const category = z.enum(CATEGORIES).describe("Food category");
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

export const UI_URI = "ui://qsr/app.html";
export const UI_MIME = "text/html;profile=mcp-app";

export function registerTools(mcp: McpServer): void {
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
        return { ...res, structuredContent: { view, tool: name, args: a, data } };
      },
    );
  };

  reg("search_restaurants", "restaurants",
    {
      description:
        "Search restaurants by location, category, rating range, review-count range, max price for one, and pure-veg. Read-only.",
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
        "Search dishes (open restaurants only) by location, category, veg flag, price range (use max_price for cheap items, min_price or sort_by price_desc for costly ones), min rating, spice level, bestsellers. Each row has the dish rating, rating count, a recent review, and the restaurant rating and review count. Read-only.",
      inputSchema: {
        location: location.optional(),
        category: category.optional(),
        is_veg: z.boolean().optional().describe("true = veg only, false = non-veg only, omit = both"),
        min_price: z.number().int().min(0).optional().describe("Min dish price in INR (for costly items)"),
        max_price: z.number().int().positive().optional().describe("Max dish price in INR (e.g. 99 for 'under 100')"),
        min_rating: z.number().min(0).max(5).optional().describe("Min dish rating"),
        spice_level: z.enum(["mild", "medium", "hot"]).optional(),
        bestseller_only: z.boolean().optional(),
        sort_by: z.enum(["rating", "price_asc", "price_desc", "popularity"]).default("rating"),
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
        "Full menu for one restaurant. Each dish has its rating, rating count and any reviews; the restaurant has rating, review count and its 5 most recent reviews. Set veg_only to hide non-veg dishes. Read-only.",
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
          .select("id, name, price, rating, rating_count, is_veg, is_bestseller, spice_level")
          .eq("restaurant_id", restaurant_id);
        if (veg_only) dq = dq.eq("is_veg", true);
        if (min_price !== undefined) dq = dq.gte("price", min_price);
        if (max_price !== undefined) dq = dq.lte("price", max_price);
        const [r, d, v] = await Promise.all([
          db()
            .from("restaurants")
            .select(
              "id, name, avg_rating, review_count, price_for_one, delivery_time_min, is_pure_veg, is_open, categories(name), locations(name, city)",
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
        "Side-by-side comparison of 2 to 4 restaurants (rating, reviews, price, delivery time, veg, open) plus each one's top-rated dishes. Get ids from other tools. Read-only.",
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
              "id, name, avg_rating, review_count, price_for_one, delivery_time_min, is_pure_veg, is_open, categories(name), locations(name)",
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

  mcp.registerTool(
    "get_reviews",
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

  mcp.registerTool(
    "list_options",
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
        "Details for one dish: price, rating, rating count, veg flag, spice level, its restaurant (rating, review count) and the dish's reviews. Read-only.",
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
        return json({ dish: d, reviews: rv });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
