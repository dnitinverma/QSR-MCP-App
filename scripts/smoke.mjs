import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const EXPECTED = ["search_restaurants", "search_dishes", "best_dish_near_me", "weak_restaurants", "get_restaurant_details", "find_dish", "restaurants_near_me", "compare_restaurants", "get_reviews", "list_options", "get_dish_details", "restaurant_offers", "dish_deals", "dietary_search", "open_now", "estimate_order", "meal_for_budget"];
const live = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_KEY);

const client = new Client({ name: "smoke", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: "node", args: ["dist/index.js"], env: process.env }));

const { tools } = await client.listTools();
const names = tools.map((t) => t.name);
console.log("tools:", names.join(", "));
const missing = EXPECTED.filter((n) => !names.includes(n));
if (missing.length) { console.error("MISSING tools:", missing.join(", ")); process.exit(1); }

if (!live) {
  console.log("SUPABASE_URL/SUPABASE_KEY not set: skipping live DB calls.");
} else {
  const calls = [
    ["search_restaurants", { location: "Hauz Khas", min_rating: 4, limit: 3 }],
    ["search_dishes", { location: "Hauz Khas", is_veg: true, max_price: 200, limit: 3 }],
    ["best_dish_near_me", { location: "Hauz Khas", is_veg: true, max_price: 200 }],
    ["weak_restaurants", { location: "Sector 62", max_rating: 3, max_reviews: 30 }],
    ["get_restaurant_details", { restaurant_id: 1 }],
    ["find_dish", { query: "paneer tikka", max_price: 250, sort_by: "price_asc", limit: 3 }],
    ["restaurants_near_me", { location: "Cyber Hub", radius_km: 2, limit: 3 }],
    ["compare_restaurants", { restaurant_ids: [1, 2] }],
    ["get_reviews", { restaurant_id: 1, max_rating: 2, limit: 3 }],
    ["list_options", {}],
    ["get_dish_details", { dish_id: 1 }],
    ["restaurant_offers", { location: "Saket", limit: 3 }],
    ["dish_deals", { location: "Saket", limit: 3 }],
    ["dietary_search", { location: "Saket", max_calories: 400, avoid_allergens: ["dairy"], limit: 3 }],
    ["open_now", { location: "Saket", at: "23:00", limit: 3 }],
    ["estimate_order", { items: [{ dish_id: 1, quantity: 2 }] }],
    ["meal_for_budget", { people: 2, budget: 700, location: "Saket" }],
  ];
  for (const [name, args] of calls) {
    const r = await client.callTool({ name, arguments: args });
    console.log(`\n# ${name}`, JSON.stringify(args));
    console.log(r.content[0].text.slice(0, 600));
  }
  // Elicitation fallback: this client has no elicitation capability.
  const r = await client.callTool({ name: "weak_restaurants", arguments: {} });
  console.log("\n# weak_restaurants (no args)\n" + r.content[0].text);
}
await client.close();
