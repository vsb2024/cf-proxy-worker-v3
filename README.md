# Cloudflare Worker - Casino Proxy (IT-31188)

This Worker proxies content from `https://online-casino-be.com/casino/be/*` to the subdirectory `/casino/be/` on the target domain with automatic rewriting of all links.

## Deployment via Cloudflare Dashboard

### Step 1: Log in to Cloudflare Dashboard
1. Go to https://dash.cloudflare.com/
2. Log in to the account that manages `vanguardngr.com`

### Step 2: Create a New Worker
1. In the left menu, select **Workers & Pages**
2. Click **Create** (or **Create application**)
3. Select **Start with Hello World!**
4. Give your Worker a name (e.g., `casino-be-proxy`)
5. Click **Deploy**

### Step 3: Insert Code
1. After creation, click **Edit code** (or **Quick edit**)
2. Delete all the default code in the editor
3. Copy all code from the `worker.js` file and paste it into the editor
4. Click **Deploy** (blue button at the top-right)


### Step 4: Add a Route
1. Navigate back to **Workers & Pages** in the left sidebar
2. Click on your Worker's name to open its overview page
3. Go to the **Settings** tab
4. Click **Domains & Routes**
5. Click **Add** > select **Route**
6. Configure the route:
   - **Zone**: select `vanguardngr.com`
   - **Route**: `www.vanguardngr.com/casino/be/*`
7. Click **Add route**

### Step 5: Verify
Open in browser: `https://www.vanguardngr.com/casino/be/`

The page should display content from `online-casino-be.com`.

## Worker Settings

In the `worker.js` file, you can configure the following parameters:

```javascript
const TARGET_ORIGIN = "https://online-casino-be.com"; // Content source
const BASE_PATH = "/casino/be"; // Prefix on your domain
const BLOCK_SEARCH_INDEXING = false; // Block search engine indexing (set true to enable)
```

## What the Worker Does

- Proxies content from `https://online-casino-be.com/casino/be/*`
- Rewrites all links (href, src, action) to your domain
- Processes srcset for responsive images
- Rewrites URLs in CSS files
- Correctly handles cookies (changes Domain)
- Handles redirects (30x)
- Optionally blocks search engine indexing (when `BLOCK_SEARCH_INDEXING = true`):
  - Adds meta tag `<meta name="robots" content="noindex, nofollow">`
  - Adds header `X-Robots-Tag: noindex, nofollow`
- Removes security headers (CSP, X-Frame-Options) for proper embedding

## Important Notes

- The upstream site `online-casino-be.com` must serve content at `/casino/be/` path
- The upstream site must be accessible from Cloudflare's network (no bot protection blocking CF Worker subrequests)
- If you see a blank page after deployment, check Security > WAF and Security > Bots settings on the upstream's Cloudflare zone

## Updating the Worker

When changing code in `worker.js`:

1. Open the Worker in Dashboard (Workers & Pages > your worker name)
2. Click **Edit code**
3. Paste the updated code
4. Click **Deploy**