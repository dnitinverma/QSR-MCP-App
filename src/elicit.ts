import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LOCATIONS } from "./config.js";

export type Field = "location" | "diet" | "review_threshold";

export interface Answers {
  location?: string;
  diet?: "veg" | "non-veg" | "both";
  review_threshold?: number;
}

export type Needs = { status: "needs_input"; missing: Field[] };

const FORMS = {
  location: {
    message: "Which area should I search near?",
    schema: {
      type: "string" as const,
      title: "Location",
      enum: [...LOCATIONS],
    },
  },
  diet: {
    message: "Veg, non-veg, or both?",
    schema: {
      type: "string" as const,
      title: "Diet",
      enum: ["veg", "non-veg", "both"],
    },
  },
  review_threshold: {
    message: "What counts as 'few reviews'? Show restaurants with at most this many reviews.",
    schema: {
      type: "string" as const,
      title: "Max review count",
      enum: ["10", "30", "100"],
    },
  },
};

/**
 * Ask ONLY for the fields in `missing`. Returns the collected answers, or a
 * needs_input result when the client lacks elicitation or the user declines.
 */
export async function ask(
  mcp: McpServer,
  missing: Field[],
): Promise<Answers | Needs> {
  if (missing.length === 0) return {};
  const needs: Needs = { status: "needs_input", missing };
  if (!mcp.server.getClientCapabilities()?.elicitation) return needs;

  const properties: Record<string, (typeof FORMS)[Field]["schema"]> = {};
  for (const f of missing) properties[f] = FORMS[f].schema;
  try {
    const res = await mcp.server.elicitInput({
      message: missing.map((f) => FORMS[f].message).join(" "),
      requestedSchema: { type: "object", properties, required: missing },
    });
    if (res.action !== "accept" || !res.content) return needs;
    const c = res.content as Record<string, string>;
    const out: Answers = {};
    if (missing.includes("location") && c.location) out.location = c.location;
    if (missing.includes("diet") && c.diet) out.diet = c.diet as Answers["diet"];
    if (missing.includes("review_threshold") && c.review_threshold)
      out.review_threshold = Number(c.review_threshold);
    const still = missing.filter((f) => out[f] === undefined);
    return still.length ? { status: "needs_input", missing: still } : out;
  } catch {
    return needs;
  }
}

export function isNeeds(x: Answers | Needs): x is Needs {
  return (x as Needs).status === "needs_input";
}
