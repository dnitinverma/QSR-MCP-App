export const LOCATIONS = [
  "Connaught Place",
  "Hauz Khas",
  "Saket",
  "Karol Bagh",
  "Lajpat Nagar",
  "Dwarka",
  "Cyber Hub",
  "Golf Course Road",
  "Sector 62",
  "Sector 18",
  "Indirapuram",
  "Gaur City",
  "Sector 15",
] as const;

export const CATEGORIES = [
  "Burgers",
  "Pizza",
  "Biryani",
  "South Indian",
  "Chinese",
  "Rolls & Wraps",
  "Desserts & Beverages",
  "Momos",
  "Chaat & Snacks",
  "North Indian Meals",
] as const;

export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 25;

export function getSupabaseEnv(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  const missing = [!url && "SUPABASE_URL", !key && "SUPABASE_KEY"].filter(Boolean);
  if (missing.length) {
    throw new Error(`Missing environment variable(s): ${missing.join(", ")}`);
  }
  return { url: url!, key: key! };
}
