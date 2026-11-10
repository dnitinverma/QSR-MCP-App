# QSR MCP Server

Read-only MCP server for food discovery over a Supabase (Postgres) database. Tools: `search_restaurants`, `search_dishes`, `best_dish_near_me`, `weak_restaurants`, `get_restaurant_details`, `find_dish`, `restaurants_near_me`, `compare_restaurants`, `get_reviews`, `list_options`, `get_dish_details`.

It is also an **MCP App**: the restaurant and dish tools render an interactive UI (`ui/app.html`, resource `ui://qsr/app.html`) in hosts that support MCP Apps. Flow: restaurant list (tick 2 to 4 to compare) > restaurant menu > dish details. Filter chips (veg, price under 100 / costly) re-run the tool from inside the card. Hosts without UI support just get the JSON text.

## Setup
1. Run `schema.sql` and `seed.sql` in your Supabase project (already done).
2. Run `supabase/functions.sql` in the Supabase SQL editor (adds 5 read-only RPC functions; safe to re-run).
3. `cp .env.example .env` and fill in the values, or export them in your shell.
4. `npm install && npm run build`

## Environment variables
| Var | Purpose |
|---|---|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_KEY` | Supabase key (server side only; never commit it) |
| `TRANSPORT` | `stdio` (default) or `http` |
| `PORT` | HTTP port when `TRANSPORT=http` (default 3000, endpoint `/mcp`, health check `/healthz`) |
| `MCP_AUTH_TOKEN` | Optional. If set, `/mcp` requires `Authorization: Bearer <token>` or `?key=<token>` |

## Run
- stdio: `npm start`
- Streamable HTTP: `TRANSPORT=http PORT=3000 npm start`
- Smoke test: `npm run smoke` (lists tools; calls each one only if credentials are set)

## Missing inputs
If a required input is missing (location for "near me", veg/non-veg for "best dish", review threshold for "low reviews"), the server asks via an MCP elicitation form. Clients without elicitation get `{"status":"needs_input","missing":[...]}` so the model asks in chat. For "both veg and non-veg" pass `diet_any: true`.

## Claude Desktop
Add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "qsr": {
      "command": "node",
      "args": ["/absolute/path/to/qsr-mcp-server/dist/index.js"],
      "env": { "SUPABASE_URL": "...", "SUPABASE_KEY": "..." }
    }
  }
}
```

## Cursor
Add to `~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project) using the same `mcpServers` block as above.

## Example prompts
- "Best veg dish near Indiranagar under 200"
- "Which restaurants have very low ratings and few reviews?"
- "Cheapest non-veg biryani rated above 4 in Cyber Hub"
- "Show hot and spicy bestsellers in Connaught Place"
- "Show the menu and recent reviews for restaurant 11"
- "Veg items under 100 rupees"
- "Show me the costliest veg dishes in Bandra West"
- "Where can I get paneer tikka roll under 150?"
- "Restaurants within 2 km of Cyber Hub"
- "Compare Dough & Co and Brownie Point"
- "What are the complaints about restaurant 1?"

## Deploy on Render (for ChatGPT and Claude)
Both apps need a public HTTPS URL, not stdio.
1. Push this folder (`qsr-mcp-server/`) as the root of a Git repo (`.gitignore` is included).
2. In Render: New > Blueprint, pick the repo. `render.yaml` sets the build and start commands.
3. Fill in `SUPABASE_URL`, `SUPABASE_KEY` and `MCP_AUTH_TOKEN` (any long random string) when prompted.
4. Your endpoint is `https://<service>.onrender.com/mcp?key=<MCP_AUTH_TOKEN>`. Free-tier services sleep when idle, so the first call can take about 30 s.

Connectors do not send custom headers, so the `?key=` form is the practical one. Anyone with the URL has access, and URLs can appear in logs, so treat the token as a password and rotate it if shared.

**Claude:** Settings > Connectors > Add custom connector > paste the URL.
**ChatGPT:** Settings > Connectors > Advanced > Developer mode, then add a connector with the URL (authentication: none).

## Test the UI locally without a host
Run with `TRANSPORT=http`, then connect any MCP Apps host, or use the MCP Apps `basic-host` from the `modelcontextprotocol/ext-apps` repo.
