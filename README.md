# infra-ui

[![npm version](https://img.shields.io/npm/v/@drprime/infra-ui)](https://www.npmjs.com/package/@drprime/infra-ui)
[![license](https://img.shields.io/npm/l/@drprime/infra-ui)](LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-DrPrime01%2Finfra--ui-181717?logo=github)](https://github.com/DrPrime01/infra-ui)

A CLI that scaffolds production-ready backend infrastructure into your Next.js app — payments, auth, email, communications, backend platforms, third-party integrations, and headless CMSs — as real files you own, not dependencies you can't touch.

```bash
npx @drprime/infra-ui init
npx @drprime/infra-ui add stripe
```

**18 components** across **8 categories** — pick what you need.

---

## What it does

`infra-ui` reads your project (package manager, ORM, router mode) and writes a fully-typed `infra/` directory with working code for the component you choose. No wrappers, no magic — just files dropped into your project that you can read, edit, and understand.

**What you get per component:**

- Server utilities and typed helpers
- Next.js API route handlers (App Router or Pages Router)
- Webhook handlers with correct signature verification and retry semantics
- ORM adapters (Prisma, Drizzle, or a manual placeholder)
- Environment variables appended to `.env.local`
- An `infra.lock.json` tracking installed files and deps

---

## Requirements

- Next.js 13+
- Node.js 18+
- A project with a `package.json`

---

## Installation

```bash
# Run directly with npx (no install required)
npx @drprime/infra-ui init

# Or install globally
npm install -g @drprime/infra-ui
infra-ui init
```

---

## Commands

### `infra-ui init`

Scans your project and writes `infra.json` — the config file that `add` reads to generate the right code for your setup.

```bash
npx @drprime/infra-ui init
```

It detects:
- **Package manager** — npm, pnpm, yarn, bun
- **ORM** — Prisma, Drizzle, or none
- **Router mode** — App Router or Pages Router
- **Base path** — where your app source lives (e.g. `src/` or `.`)

The resulting `infra.json` looks like:

```json
{
  "packageManager": "npm",
  "orm": "prisma",
  "basePath": ".",
  "isAppRouter": true
}
```

Commit this file. It's the source of truth for all future `add` commands.

---

### `infra-ui add <component>`

Fetches a component from the registry and writes it into your project.

```bash
# Payments
npx @drprime/infra-ui add stripe
npx @drprime/infra-ui add paystack
npx @drprime/infra-ui add flutterwave

# Email
npx @drprime/infra-ui add resend
npx @drprime/infra-ui add sendgrid

# Communications
npx @drprime/infra-ui add twilio

# Auth
npx @drprime/infra-ui add authjs
npx @drprime/infra-ui add clerk

# Backend platforms
npx @drprime/infra-ui add firebase
npx @drprime/infra-ui add supabase

# Third-party integrations
npx @drprime/infra-ui add google-calendar
npx @drprime/infra-ui add calendly
npx @drprime/infra-ui add google-maps

# Headless CMS
npx @drprime/infra-ui add strapi
npx @drprime/infra-ui add sanity
npx @drprime/infra-ui add contentful
npx @drprime/infra-ui add hygraph

# Database
npx @drprime/infra-ui add neon
```

The CLI will:
1. Prompt for any required API keys/secrets
2. Write files to `infra/<component>/` (and API routes to `app/api/` or `pages/api/`)
3. Install npm dependencies
4. Append env vars to `.env.local`
5. Update `infra.lock.json`

If a component is already installed, you'll be asked before anything is overwritten.

---

## Components

### Payments

#### `stripe`

Subscription billing via Stripe Checkout, plus a webhook handler for lifecycle events.

**Generated files:**

| File | Description |
|------|-------------|
| `infra/stripe/client.ts` | Stripe SDK singleton with env guard |
| `infra/stripe/actions.ts` | `createCheckoutSession()` and `createBillingPortalSession()` server actions |
| `infra/stripe/webhooks.ts` | `handleStripeEvent()` with `subscriptionIdOf()` helper |
| `infra/stripe/adapter.ts` | ORM-specific `upsertSubscription()` |
| `app/api/webhooks/stripe/route.ts` | Webhook endpoint with raw-body signature verification |

**Env vars written:**

```
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
NEXT_PUBLIC_APP_URL=
```

**ORM adapters:** Prisma, Drizzle, manual placeholder

---

#### `paystack`

Paystack payments via Inline.js popup — amount set server-side, popup opened client-side with an `access_code`.

**Generated files:**

| File | Description |
|------|-------------|
| `infra/paystack/client.ts` | `paystackRequest()` fetch helper with secret-key guard |
| `infra/paystack/actions.ts` | `initializeTransaction()` and `verifyTransaction()` server actions |
| `infra/paystack/webhooks.ts` | HMAC-SHA512 verification + `handlePaystackEvent()` |
| `infra/paystack/checkout.tsx` | `<PaystackCheckoutButton>` client component |
| `infra/paystack/adapter.ts` | ORM-specific `recordPayment()` with idempotent upsert |
| `app/api/webhooks/paystack/route.ts` | Webhook endpoint |

**Env vars written:**

```
PAYSTACK_SECRET_KEY=
NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY=
```

**Amount note:** amounts are in the smallest currency unit (kobo for NGN). Multiply by 100.

**ORM adapters:** Prisma, Drizzle, manual placeholder

---

#### `flutterwave`

Flutterwave inline payments via `@flutterwave/flutterwave-react-v3` — popup opens client-side; webhook is the authoritative record.

**Generated files:**

| File | Description |
|------|-------------|
| `infra/flutterwave/client.ts` | `flutterwaveRequest()` fetch helper with secret-key guard (`server-only`) |
| `infra/flutterwave/actions.ts` | `initializePayment()` and `verifyTransaction()` server actions |
| `infra/flutterwave/webhooks.ts` | `verif-hash` verification (timing-safe) + `handleFlutterwaveEvent()` |
| `infra/flutterwave/checkout.tsx` | `<FlutterwaveCheckoutButton>` via the `useFlutterwave` hook |
| `infra/flutterwave/adapter.ts` | ORM-specific `recordPayment()` keyed on `tx_ref` (idempotent) |
| `app/api/webhooks/flutterwave/route.ts` | Webhook endpoint |

**Env vars written:**

```
FLW_SECRET_KEY=
NEXT_PUBLIC_FLW_PUBLIC_KEY=
FLW_WEBHOOK_SECRET=
```

**Amount note:** amounts are in the smallest currency unit (kobo for NGN, cents for USD, etc).

**ORM adapters:** Prisma, Drizzle, manual placeholder

---

### Auth

#### `authjs`

Auth.js v5 (NextAuth beta) with session callback, ORM adapter, and middleware.

**Generated files:**

| File | Description |
|------|-------------|
| `auth.ts` | NextAuth config with session callback and adapter |
| `infra/auth/adapter.ts` | ORM-specific adapter (`PrismaAdapter` / `DrizzleAdapter` / placeholder) |
| `app/api/auth/[...nextauth]/route.ts` | Route handler |
| `middleware.ts` | Auth middleware (written only if no existing middleware is detected) |

**Env vars written:**

```
AUTH_SECRET=          # auto-generated base64url secret
AUTH_GITHUB_ID=
AUTH_GITHUB_SECRET=
```

**Providers:** GitHub is scaffolded by default. Add others by editing `auth.ts`.

**ORM adapters:** Prisma (`@auth/prisma-adapter`), Drizzle (`@auth/drizzle-adapter`), manual placeholder

---

#### `clerk`

Clerk authentication with sign-in/sign-up pages, middleware, and webhook handler for user sync.

**Generated files (App Router):**

| File | Description |
|------|-------------|
| `app/(auth)/sign-in/[[...sign-in]]/page.tsx` | Sign-in page |
| `app/(auth)/sign-up/[[...sign-up]]/page.tsx` | Sign-up page |
| `middleware.ts` | `clerkMiddleware()` (non-destructive — writes sidecar if middleware exists) |
| `app/api/webhooks/clerk/route.ts` | Svix webhook with user sync |
| `infra/clerk/adapter.ts` | ORM-specific user upsert on `user.created` / `user.updated` |

**Env vars written:**

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
CLERK_WEBHOOK_SECRET=
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
```

**ORM adapters:** Prisma, Drizzle, manual placeholder

**Pages Router:** also supported — uses `micro` for raw-body parsing.

---

### Email

#### `resend`

Transactional email via Resend with a typed `sendEmail` server action.

**Generated files:**

| File | Description |
|------|-------------|
| `infra/resend/client.ts` | Resend client singleton |
| `infra/resend/actions.ts` | `sendEmail()` server action |
| `infra/resend/templates/welcome.tsx` | Example React Email template |

**Env vars written:**

```
RESEND_API_KEY=
RESEND_FROM_EMAIL=
```

---

#### `sendgrid`

SendGrid transactional email with Dynamic Templates plus an Event Webhook for delivery tracking (bounces, unsubscribes, spam reports).

**Generated files:**

| File | Description |
|------|-------------|
| `infra/sendgrid/client.ts` | `@sendgrid/mail` client (`sgMail.setApiKey`), `server-only` |
| `infra/sendgrid/actions.ts` | `sendEmail()` (raw HTML) + `sendWithTemplate()` (Dynamic Templates) |
| `infra/sendgrid/webhooks.ts` | ECDSA P-256 signature verification + `handleSendGridEvents()` (event batch) |
| `app/api/webhooks/sendgrid/route.ts` | Event Webhook endpoint |

**Env vars written:**

```
SENDGRID_API_KEY=
SENDGRID_FROM_EMAIL=
SENDGRID_WEBHOOK_PUBLIC_KEY=     # optional — only for Signed Event Webhooks
```

**Signature note:** the Event Webhook is verified with ECDSA P-256 (`crypto.verify` with `dsaEncoding: "ieee-p1363"`) — the public key comes from SendGrid's Signed Event Webhooks settings.

---

### Communications

#### `twilio`

Twilio Programmable SMS, outbound voice calls, and Verify (2FA OTP).

**Generated files:**

| File | Description |
|------|-------------|
| `infra/twilio/client.ts` | Twilio client singleton with env guards |
| `infra/twilio/sms.ts` | `sendSms()` server action |
| `infra/twilio/voice.ts` | `makeCall()` server action |
| `infra/twilio/verify.ts` | `sendVerificationCode()` + `checkVerificationCode()` |
| `infra/twilio/webhook-url.ts` | Proxy-aware URL reconstruction for signature validation |
| `app/api/webhooks/twilio/sms/route.ts` | Incoming SMS webhook with TwiML reply |
| `app/api/webhooks/twilio/voice/route.ts` | Incoming voice webhook with TwiML response |

**Env vars written:**

```
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
TWILIO_VERIFY_SERVICE_SID=
TWILIO_WEBHOOK_BASE_URL=
```

**Proxy note:** if your app runs behind a reverse proxy (Vercel, Cloudflare, ngrok), set `TWILIO_WEBHOOK_BASE_URL` to your public URL so Twilio signature validation works correctly.

---

### Backend platforms

Both Firebase and Supabase support a **multi-service prompt**: pick only the services you need (Auth, Database, Storage, etc) — the CLI generates only those files.

#### `firebase`

Firebase Auth, Firestore, Storage, and Cloud Messaging — with session-cookie auth, Admin SDK helpers, and Node-runtime middleware.

**Always generated:**

| File | Description |
|------|-------------|
| `infra/firebase/client.ts` | Browser SDK singleton |
| `infra/firebase/admin.ts` | Admin SDK singleton — service account creds, `server-only` |

**`auth` service (optional):** sign-in helpers, session-cookie create/verify with refresh-token revocation, 5-minute max-age check on ID tokens, `middleware.ts` with `runtime = "nodejs"`.
**`firestore` service (optional):** typed `getDocument` / `setDocument` / `updateDocument` / `deleteDocument` / `queryDocuments`.
**`storage` service (optional):** signed upload/download URLs + `deleteFile`, with path-traversal guards.
**`messaging` service (optional):** `sendPushNotification` and `sendMulticast`.

**Env vars written:**

```
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
FIREBASE_ADMIN_PROJECT_ID=
FIREBASE_ADMIN_CLIENT_EMAIL=
FIREBASE_ADMIN_PRIVATE_KEY=     # PEM, newlines preserved
```

---

#### `supabase`

Supabase Auth, Database, Storage, and Realtime — Edge-compatible middleware, `@supabase/ssr` based.

**Always generated:**

| File | Description |
|------|-------------|
| `infra/supabase/client.ts` | Browser client via `createBrowserClient` |
| `infra/supabase/server.ts` | Server client via `createServerClient` (`server-only`) |
| `infra/supabase/admin.ts` | Service-role client — bypasses RLS, `server-only` |

**`auth` service (optional):** `signInWithEmail`, `signInWithOAuth`, `signOut`, `getUser` server actions + `/auth/callback` route with safe-redirect guards + Edge-compatible middleware.
**`database` service (optional):** typed `getRow`/`insertRow`/`updateRow`/`deleteRow`/`queryRows`.
**`storage` service (optional):** `uploadFile` (with `upsert: false` default + path validation), `getSignedUrl`, `deleteFile`, `createBucket`.
**`realtime` service (optional):** `subscribeToTable` (with identifier validation) and `subscribeToChannel`.

**Env vars written:**

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_SITE_URL=           # only if auth service selected
```

---

### Third-party integrations

#### `google-calendar`

Per-user Google Calendar access via OAuth 2.0, with automatic token refresh and HMAC-signed state to block account-link CSRF.

**Generated files:**

| File | Description |
|------|-------------|
| `infra/google-calendar/token-store.ts` | Adapter wrapper for token persistence |
| `infra/google-calendar/client.ts` | `createCalendarClient(userId)` — loads + refreshes tokens, `server-only` |
| `infra/google-calendar/oauth.ts` | `getAuthorizationUrl` + `handleOAuthCallback` with HMAC-signed state |
| `infra/google-calendar/events.ts` | `listEvents`, `createEvent`, `updateEvent`, `deleteEvent` |
| `infra/google-calendar/adapter.ts` | ORM-specific `getTokens` / `saveTokens` |
| `app/api/auth/google-calendar/callback/route.ts` | OAuth callback (verifies session matches state) |

**Env vars written:**

```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=           # also used as HMAC key for state
GOOGLE_REDIRECT_URI=
```

**ORM adapters:** Prisma, Drizzle, manual placeholder

---

#### `calendly`

Calendly scheduling API + webhook handler with HMAC-SHA256 signature verification and 5-minute replay window.

**Generated files:**

| File | Description |
|------|-------------|
| `infra/calendly/client.ts` | `calendlyRequest()` fetch helper, `server-only` |
| `infra/calendly/actions.ts` | `getCurrentUser`, `listEventTypes`, `listScheduledEvents`, `getScheduledEvent`, `listInvitees` |
| `infra/calendly/webhooks.ts` | `verifyWebhookSignature` (HMAC-SHA256 hex, replay-protected) + `handleCalendlyEvent` |
| `app/api/webhooks/calendly/route.ts` | Webhook endpoint |

**Env vars written:**

```
CALENDLY_PERSONAL_ACCESS_TOKEN=
CALENDLY_WEBHOOK_SIGNING_KEY=
```

---

#### `google-maps`

Five selectable Google Maps services. No SDK — pure REST via the official endpoints. Multi-service prompt selects what to generate.

**Always generated:**

| File | Description |
|------|-------------|
| `infra/google-maps/client.ts` | `mapsRequest<T>()` helper, status-aware error handling, `server-only` |

**Selectable services:**

| Service | File | What it generates |
|---------|------|-------------------|
| `geocoding` | `geocoding.ts` | `geocodeAddress` ↔ `reverseGeocode` |
| `places` | `places.ts` | `searchPlaces`, `getPlaceDetails`, `getAutocompleteSuggestions` |
| `directions` | `directions.ts` | `getDirections` with waypoints + avoid options |
| `distance-matrix` | `distance-matrix.ts` | `getDistances` for multi-origin × multi-destination grids |
| `static-maps` | `static-maps.ts` | `fetchStaticMap()` (returns bytes) + `staticMapResponse()` (Next.js `Response`) — server-side only to keep the API key out of HTML |

**Env vars written:**

```
GOOGLE_MAPS_API_KEY=            # server-side only
```

---

### Headless CMS

All three CMS components ship with **Next.js ISR cache invalidation** in their webhook handlers — content publishes auto-bust `revalidateTag(contentType)`.

#### `strapi`

Strapi v4/v5 REST API + webhook cache revalidation. Single API token, verbatim secret header verification.

**Generated files:**

| File | Description |
|------|-------------|
| `infra/strapi/client.ts` | `strapiRequest<T>()` with Bearer auth, `server-only` |
| `infra/strapi/actions.ts` | `findMany`, `findOne`, `findBySlug`, `create`, `update`, `deleteEntry` |
| `infra/strapi/webhooks.ts` | `verifyWebhookSecret` (timing-safe) + `handleStrapiEvent` with `revalidateTag` |
| `app/api/webhooks/strapi/route.ts` | Webhook endpoint (checks `Authorization` header) |

**Env vars written:**

```
STRAPI_URL=
STRAPI_API_TOKEN=
STRAPI_WEBHOOK_SECRET=
```

---

#### `sanity`

Sanity CMS with GROQ queries via `@sanity/client`. HMAC-SHA256 base64url webhook signature + draft-document guard.

**Generated files:**

| File | Description |
|------|-------------|
| `infra/sanity/client.ts` | `sanityClient` (`createClient`), `server-only` |
| `infra/sanity/queries.ts` | `query<T>` escape hatch + `getDocumentsByType`, `getDocumentById`, `getBySlug` |
| `infra/sanity/webhooks.ts` | `verifyWebhookSignature` (HMAC-SHA256 base64url, replay-protected) + `handleSanityEvent` |
| `app/api/webhooks/sanity/route.ts` | Webhook endpoint (skips revalidation for `drafts.*` documents) |

**Env vars written:**

```
NEXT_PUBLIC_SANITY_PROJECT_ID=
NEXT_PUBLIC_SANITY_DATASET=       # defaults to "production"
SANITY_API_TOKEN=                 # optional — public datasets work without it
SANITY_WEBHOOK_SECRET=
```

---

#### `contentful`

Contentful with separate delivery + preview clients (for Next.js Draft Mode). Topic-aware webhook handler.

**Generated files:**

| File | Description |
|------|-------------|
| `infra/contentful/client.ts` | `deliveryClient` (always) + lazy `getPreviewClient()`, `server-only` |
| `infra/contentful/queries.ts` | `getEntriesByType`, `getEntryById`, `getEntryBySlug`, `getEntryPreview` |
| `infra/contentful/webhooks.ts` | `verifyWebhookSecret` (timing-safe) + `handleContentfulEvent(payload, topic)` |
| `app/api/webhooks/contentful/route.ts` | Reads both `x-contentful-secret` and `x-contentful-topic` headers |

**Env vars written:**

```
CONTENTFUL_SPACE_ID=
CONTENTFUL_DELIVERY_TOKEN=
CONTENTFUL_PREVIEW_TOKEN=         # optional — Draft Mode only
CONTENTFUL_WEBHOOK_SECRET=
```

---

#### `hygraph`

Hygraph (formerly GraphCMS) — GraphQL-native CMS via `graphql-request`, with ISR cache tags threaded through each query and webhook revalidation.

**Generated files:**

| File | Description |
|------|-------------|
| `infra/hygraph/client.ts` | `hygraphClient` + lazy `getPreviewClient()`, `server-only` |
| `infra/hygraph/queries.ts` | `query<T>`, `getEntriesByModel`, `getEntryBySlug`, `getEntryById`, `getEntryPreview` |
| `infra/hygraph/webhooks.ts` | `verifyWebhookSecret` (timing-safe) + `handleHygraphEvent` keyed on `__typename` |
| `app/api/webhooks/hygraph/route.ts` | Reads the `gcms-webhook-signature` header |

**Env vars written:**

```
HYGRAPH_API_URL=
HYGRAPH_API_TOKEN=               # optional — public endpoints work without it
HYGRAPH_PREVIEW_URL=             # optional — Draft Mode only
HYGRAPH_WEBHOOK_SECRET=
```

**ISR note:** queries pass `next: { tags: [...] }` through a custom `fetch` so `revalidateTag()` in the webhook handler busts the right cache entries.

---

### Database

#### `neon`

Neon serverless Postgres. Pick your layer at install time — **Prisma**, **Drizzle**, or **raw SQL** — pre-selected from the ORM detected during `infra-ui init`.

**Always generated:**

| File | Description |
|------|-------------|
| `infra/neon/client.ts` | `sql` — Neon HTTP query function (Edge-compatible, parameterized), `server-only` |

**Per ORM choice:**

| Choice | File | What it generates |
|--------|------|-------------------|
| Prisma | `adapter.ts` | `PrismaClient` with `@prisma/adapter-neon` + WebSocket pool, singleton hot-reload guard |
| Drizzle | `adapter.ts` | `drizzle(neon(url))` via `drizzle-orm/neon-http` — fully Edge-compatible |
| None / raw SQL | `db.ts` | `query<T>` tagged-template helper + an allowlisted `getRows<T>` example, `server-only` |

**Env vars written:**

```
DATABASE_URL=
```

**Composition:** Neon is just the database — it sits under your ORM, not beside it. Prisma users get `@prisma/adapter-neon` + `ws` installed automatically via `conditionalDeps`.

---

## ORM Adapter Support

When you run `infra-ui add`, the CLI reads the `orm` field from `infra.json` and writes an adapter to `infra/<component>/adapter.ts` matching your ORM:

| `orm` value | What's generated |
|-------------|-----------------|
| `prisma` | Prisma Client queries |
| `drizzle-orm` | Drizzle queries with `onConflictDoUpdate` |
| `manual` | Placeholder with `// TODO` comments |

Components that ship adapters: **stripe, paystack, flutterwave, clerk, authjs, google-calendar.** Switch adapters at any time by re-running `infra-ui add <component>` and choosing to overwrite.

Components like **firebase, supabase, strapi, sanity, contentful** don't ship adapters — they ARE the data layer, and the helpers in their `queries.ts` / `firestore.ts` / `db.ts` are what you call from your code.

---

## App Router vs Pages Router

The CLI detects `isAppRouter` from `infra.json` and writes route handlers to the right place:

| Mode | API routes written to |
|------|-----------------------|
| App Router | `app/api/...` |
| Pages Router | `pages/api/...` |

Some components (Clerk, Auth.js) also adjust their middleware strategy based on the Next.js version detected.

---

## Lock File

Every `add` run updates `infra.lock.json` with:

```json
{
  "stripe": {
    "files": ["infra/stripe/client.ts", "..."],
    "deps": ["stripe"],
    "installedAt": "2026-06-02T12:00:00.000Z"
  }
}
```

This lets the CLI detect already-installed components and prompt before overwriting. Commit this file alongside `infra.json`.

---

## Registry Override

By default, component templates are fetched from:

```
https://raw.githubusercontent.com/DrPrime01/infra-ui/refs/heads/main/packages/registry/<component>.json
```

To pin to a different source (private fork, local dev server):

```bash
INFRA_REGISTRY_BASE=http://localhost:3001 npx @drprime/infra-ui add stripe
```

---

## Security

The CLI itself:

- All secrets are collected via masked password prompts — never echoed to the terminal
- Path traversal and symlink-escape protection on all file writes
- Dependency names are validated against an npm-package regex before `npm install` (no shell injection)
- Registry payloads are size-capped (1 MiB) and optionally SHA-256 verified

What the generated components do:

- **`import "server-only"`** in every file that uses secret env vars — guarantees admin/service tokens can never bundle into the client
- **Webhook signature verification** uses `crypto.timingSafeEqual` in every component (Paystack HMAC-SHA512, Stripe + Calendly HMAC-SHA256 hex, Sanity HMAC-SHA256 base64url, Flutterwave/Strapi/Contentful verbatim secret)
- **Replay-attack protection** with 5-minute timestamp tolerance on every HMAC-based webhook (Stripe, Calendly, Sanity)
- **4xx/5xx separation** in webhook handlers: `400` for bad signatures (no retry), `500` for handler errors (retryable by the provider)
- **Firebase session cookies** revoke server-side on sign-out (`revokeRefreshTokens`) and reject ID tokens older than 5 minutes when minting
- **Supabase middleware** uses path-boundary matching (no `/sign-in-evil` bypass) and rejects open-redirect attempts via `next` param
- **Google Calendar OAuth state** is HMAC-signed with a 10-minute window — prevents account-link CSRF
- **Google Maps static maps** are fetched server-side; the API key never enters HTML or network traces visible to the browser
- **Firebase + Supabase storage** paths reject `..`, null bytes, and leading `/`
- **Supabase storage** defaults `upsert: false` so path collisions don't silently overwrite data
- **Supabase realtime** identifiers are regex-validated; module docs spell out the RLS prerequisites

---

## Contributing

This is a monorepo with two packages:

```
packages/
  cli/        — the @drprime/infra-ui CLI (TypeScript, commander, @clack/prompts)
  registry/   — JSON component templates fetched at runtime
apps/
  test-infra-ui/  — Next.js test app
```

To build the CLI locally:

```bash
cd packages/cli
npm run build
```

To test an add command against the local registry:

```bash
INFRA_REGISTRY_BASE=file://$(pwd)/packages/registry node packages/cli/dist/index.js add stripe
```

---

## Contributing

Issues and pull requests are welcome on [GitHub](https://github.com/DrPrime01/infra-ui).

## License

MIT
