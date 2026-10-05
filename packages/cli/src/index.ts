#!/usr/bin/env node
import { Command } from "commander";
import { execFile } from "child_process";
import util from "util";
import fs from "fs-extra";
import path from "path";
import crypto from "crypto";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { detectEnvironment, DetectedORM, PackageManager } from "./scanner.js";
import { generateComponent, ComponentOptions } from "./generator.js";

const execFileAsync = util.promisify(execFile);
const program = new Command();

program
  .name("infra-ui")
  .description("Add critical infrastructure components to your app")
  .version("0.3.0");

const VALID_PACKAGE_MANAGERS: readonly PackageManager[] = [
  "npm",
  "pnpm",
  "yarn",
  "bun",
];

const VALID_ORM_VALUES: readonly string[] = [
  "prisma",
  "drizzle-orm",
  "sequelize",
  "typeorm",
  "mikro-orm",
  "typeorm-legacy",
  "objection",
  "knex",
  "typeorm-next",
  "typeorm-legacy-next",
  "manual",
  "UNKNOWN",
];

const VALID_DEP_RE = /^[@a-zA-Z0-9][a-zA-Z0-9._@/\-]*$/;

const VALID_COMPONENT_RE = /^[a-z][a-z0-9-]*$/;

const required = (label: string) => (v: string | undefined) =>
  !v || v.trim().length === 0 ? `${label} is required` : undefined;

function validateConfig(
  raw: unknown,
  projectRoot: string,
): {
  packageManager: PackageManager;
  orm: DetectedORM;
  basePath: string;
  isAppRouter: boolean;
} {
  if (!raw || typeof raw !== "object") {
    throw new Error("infra.json is malformed — expected a JSON object.");
  }
  const c = raw as Record<string, unknown>;

  if (!VALID_PACKAGE_MANAGERS.includes(c.packageManager as PackageManager)) {
    throw new Error(
      `Invalid packageManager "${c.packageManager}" in infra.json. Must be one of: ${VALID_PACKAGE_MANAGERS.join(", ")}.`,
    );
  }
  if (!VALID_ORM_VALUES.includes(c.orm as string)) {
    throw new Error(`Invalid orm "${c.orm}" in infra.json.`);
  }
  if (typeof c.basePath !== "string") {
    throw new Error("Invalid basePath in infra.json — must be a string.");
  }
  if (path.isAbsolute(c.basePath)) {
    throw new Error("basePath in infra.json must be relative, not absolute.");
  }
  const resolvedBase = path.resolve(projectRoot, c.basePath);
  const resolvedRoot = path.resolve(projectRoot);
  if (
    resolvedBase !== resolvedRoot &&
    !resolvedBase.startsWith(resolvedRoot + path.sep)
  ) {
    throw new Error(
      `basePath in infra.json escapes the project root: "${c.basePath}".`,
    );
  }

  return {
    packageManager: c.packageManager as PackageManager,
    orm: c.orm as DetectedORM,
    basePath: c.basePath,
    isAppRouter: typeof c.isAppRouter === "boolean" ? c.isAppRouter : true,
  };
}

program
  .command("init")
  .description("Initialize configuration and setup infra.json")
  .action(async () => {
    console.clear();
    p.intro(pc.bgCyan(pc.black(" infra-ui init ")));

    const projectRoot = process.cwd();
    const configPath = path.join(projectRoot, "infra.json");

    if (await fs.pathExists(configPath)) {
      const overwrite = await p.confirm({
        message:
          "An infra.json file already exists. Do you want to overwrite it?",
        initialValue: false,
      });

      if (p.isCancel(overwrite) || !overwrite) {
        p.cancel("Initialization aborted.");
        process.exit(0);
      }
    }

    const s = p.spinner();
    s.start("Scanning your project structure...");
    const env = await detectEnvironment(projectRoot);
    s.stop("Project analysis complete!");

    let chosenORM: DetectedORM | null = env.orm || null;

    if (env.orm === "UNKNOWN") {
      const selection = await p.select({
        message: "Which database ORM or tool are you using?",
        options: [
          { value: "prisma", label: "Prisma" },
          { value: "drizzle-orm", label: "Drizzle ORM" },
          { value: "manual", label: "None / Custom Setup" },
        ],
      });

      if (p.isCancel(selection)) {
        p.cancel("Aborted.");
        process.exit(0);
      }
      chosenORM = selection as DetectedORM;
    }

    const config = {
      packageManager: env.packageManager,
      orm: chosenORM,
      basePath: env.basePath,
      isAppRouter: env.isAppRouter,
    };

    await fs.outputJson(configPath, config, { spaces: 2 });

    p.outro(
      `🎉 ${pc.green("Success!")} Created ${pc.cyan("infra.json")} at the root of your project.`,
    );
  });

const FALLBACK_COMPONENTS = [
  "stripe",
  "resend",
  "twilio",
  "authjs",
  "clerk",
  "paystack",
  "firebase",
  "flutterwave",
  "supabase",
  "google-calendar",
  "calendly",
  "google-maps",
  "strapi",
  "sanity",
  "contentful",
  "hygraph",
  "sendgrid",
  "neon",
];
const REGISTRY_MANIFEST_URL = `${process.env.INFRA_REGISTRY_BASE ?? "https://raw.githubusercontent.com/DrPrime01/infra-ui/refs/heads/main/packages/registry"}/manifest.json`;

// Reads component names from the registry manifest, falling back to a built-in list offline.
async function getSupportedComponents(): Promise<string[]> {
  try {
    const res = await fetch(REGISTRY_MANIFEST_URL, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const manifest = (await res.json()) as {
      components?: Array<{ name: string }>;
    };
    const names = manifest.components?.map((c) => c.name) ?? [];
    return names.length > 0 ? names : FALLBACK_COMPONENTS;
  } catch {
    return FALLBACK_COMPONENTS;
  }
}

program
  .command("add <component>")
  .description("Add a new infrastructure component to your project")
  .action(async (component: string) => {
    if (!VALID_COMPONENT_RE.test(component)) {
      p.log.error(
        `Component name "${component}" is invalid. Use lowercase letters, digits, and hyphens.`,
      );
      process.exit(1);
    }
    const supported = await getSupportedComponents();
    if (!supported.includes(component)) {
      p.log.error(`Component "${component}" is not supported yet.`);
      p.log.info(`Available components: ${supported.join(", ")}`);
      process.exit(1);
    }

    console.clear();
    p.intro(pc.bgCyan(pc.black(` Installing ${component} `)));

    const projectRoot = process.cwd();
    const configPath = path.join(projectRoot, "infra.json");

    if (!(await fs.pathExists(configPath))) {
      p.log.error(
        `Configuration file missing. Please run ${pc.green("npx infra-ui init")} first.`,
      );
      process.exit(1);
    }

    let config: ReturnType<typeof validateConfig>;
    try {
      config = validateConfig(await fs.readJson(configPath), projectRoot);
    } catch (err: unknown) {
      p.log.error(
        err instanceof Error ? err.message : "Failed to read infra.json.",
      );
      process.exit(1);
    }

    const { orm: chosenORM, packageManager: pm, basePath, isAppRouter } = config;

    try {
      const env = await detectEnvironment(projectRoot);
      if (env.orm !== "UNKNOWN" && env.orm !== chosenORM) {
        p.log.warn(
          `infra.json says orm="${chosenORM}" but project has "${env.orm}". Generated adapters may not work.`,
        );
      }
      if (env.packageManager !== pm) {
        p.log.warn(
          `infra.json says packageManager="${pm}" but project lockfile suggests "${env.packageManager}".`,
        );
      }
      if (env.isAppRouter !== isAppRouter) {
        p.log.warn(
          `infra.json says isAppRouter=${isAppRouter} but project looks like ${env.isAppRouter ? "App Router" : "Pages Router"}.`,
        );
      }
    } catch {}

    const componentOptions: ComponentOptions = {
      providers: [],
      env: {},
      isAppRouter,
    };

    if (component === "authjs") {
      const providerSelection = await p.multiselect({
        message: "Which authentication providers do you want to configure?",
        options: [
          { value: "google", label: "Google" },
          { value: "github", label: "GitHub" },
          { value: "facebook", label: "Facebook" },
          { value: "discord", label: "Discord" },
        ],
        required: false,
      });

      if (p.isCancel(providerSelection)) {
        p.cancel("Aborted.");
        process.exit(0);
      }

      componentOptions.providers = providerSelection as string[];

      if (componentOptions.providers.length > 0) {
        p.note(
          "Provide your OAuth keys below. Leave blank to generate empty placeholders in your .env.local file.",
        );

        for (const provider of componentOptions.providers) {
          const clientId = await p.text({
            message: `${provider.toUpperCase()} Client ID:`,
            placeholder: `Enter your ${provider} client ID...`,
            validate: required(`${provider} client ID`),
          });
          if (p.isCancel(clientId)) process.exit(0);

          const clientSecret = await p.password({
            message: `${provider.toUpperCase()} Client Secret:`,
            validate: required(`${provider} client secret`),
          });
          if (p.isCancel(clientSecret)) process.exit(0);

          componentOptions.env[`AUTH_${provider.toUpperCase()}_ID`] =
            clientId as string;
          componentOptions.env[`AUTH_${provider.toUpperCase()}_SECRET`] =
            clientSecret as string;
        }
      }

      p.note("Generating a secure AUTH_SECRET automatically...", "Security");
      componentOptions.env["AUTH_SECRET"] = crypto
        .randomBytes(32)
        .toString("base64url");
    }

    if (component === "clerk") {
      p.note("Provide your Clerk API keys from the Clerk dashboard.");

      const publishableKey = await p.text({
        message: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:",
        placeholder: "pk_test_...",
        validate: required("Publishable key"),
      });
      if (p.isCancel(publishableKey)) process.exit(0);

      const secretKey = await p.password({
        message: "CLERK_SECRET_KEY:",
        validate: required("Secret key"),
      });
      if (p.isCancel(secretKey)) process.exit(0);

      const webhookSecret = await p.password({
        message:
          "CLERK_WEBHOOK_SECRET (optional — leave blank to fill in later):",
      });
      if (p.isCancel(webhookSecret)) process.exit(0);

      componentOptions.env["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"] =
        publishableKey as string;
      componentOptions.env["CLERK_SECRET_KEY"] = secretKey as string;

      const ws = (webhookSecret as string | undefined)?.trim() ?? "";
      if (ws.length > 0) {
        componentOptions.env["CLERK_WEBHOOK_SECRET"] = ws;
      } else {
        componentOptions.env["CLERK_WEBHOOK_SECRET"] =
          "whsec_REPLACE_ME_BEFORE_DEPLOY";
        p.log.warn(
          "CLERK_WEBHOOK_SECRET left blank — replace the placeholder in .env.local before deploying, or webhook verification will fail.",
        );
      }
    }

    if (component === "resend") {
      p.note("Provide your Resend credentials from resend.com/api-keys.");

      const apiKey = await p.password({
        message: "RESEND_API_KEY:",
        validate: required("API key"),
      });
      if (p.isCancel(apiKey)) process.exit(0);

      const fromEmail = await p.text({
        message: "RESEND_FROM_EMAIL (verified sender, e.g. \"Acme <hi@acme.dev>\"):",
        placeholder: "Acme <onboarding@resend.dev>",
        validate: required("From email"),
      });
      if (p.isCancel(fromEmail)) process.exit(0);

      componentOptions.env["RESEND_API_KEY"] = apiKey as string;
      componentOptions.env["RESEND_FROM_EMAIL"] = fromEmail as string;
    }

    if (component === "twilio") {
      p.note(
        "Provide your Twilio credentials from the Twilio Console (console.twilio.com).",
      );

      const accountSid = await p.text({
        message: "TWILIO_ACCOUNT_SID:",
        placeholder: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        validate: required("Account SID"),
      });
      if (p.isCancel(accountSid)) process.exit(0);

      const authToken = await p.password({
        message: "TWILIO_AUTH_TOKEN:",
        validate: required("Auth token"),
      });
      if (p.isCancel(authToken)) process.exit(0);

      const phoneNumber = await p.text({
        message: "TWILIO_PHONE_NUMBER (your Twilio number, E.164 format):",
        placeholder: "+12345678900",
        validate: required("Phone number"),
      });
      if (p.isCancel(phoneNumber)) process.exit(0);

      const verifyServiceSid = await p.text({
        message:
          "TWILIO_VERIFY_SERVICE_SID (leave blank to skip 2FA / Verify):",
        placeholder: "VAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      });
      if (p.isCancel(verifyServiceSid)) process.exit(0);

      componentOptions.env["TWILIO_ACCOUNT_SID"] = accountSid as string;
      componentOptions.env["TWILIO_AUTH_TOKEN"] = authToken as string;
      componentOptions.env["TWILIO_PHONE_NUMBER"] = phoneNumber as string;
      if ((verifyServiceSid as string).trim()) {
        componentOptions.env["TWILIO_VERIFY_SERVICE_SID"] =
          verifyServiceSid as string;
      }
    }

    if (component === "paystack") {
      p.note("Provide your Paystack API keys from the Paystack dashboard.");

      const secretKey = await p.password({
        message: "PAYSTACK_SECRET_KEY:",
        validate: required("Secret key"),
      });
      if (p.isCancel(secretKey)) process.exit(0);

      const publicKey = await p.text({
        message: "NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY:",
        placeholder: "pk_test_...",
        validate: required("Public key"),
      });
      if (p.isCancel(publicKey)) process.exit(0);

      componentOptions.env["PAYSTACK_SECRET_KEY"] = secretKey as string;
      componentOptions.env["NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY"] = publicKey as string;
    }

    if (component === "firebase") {
      const selectedServices = await p.multiselect({
        message: "Which Firebase services do you want to add?",
        options: [
          {
            value: "auth",
            label: "Authentication",
            hint: "Email, Google, GitHub sign-in + session cookies + middleware",
          },
          {
            value: "firestore",
            label: "Firestore",
            hint: "Typed Admin SDK helpers (get, set, update, delete, query)",
          },
          {
            value: "storage",
            label: "Storage",
            hint: "Signed upload/download URLs",
          },
          {
            value: "messaging",
            label: "Cloud Messaging",
            hint: "FCM push notifications via Admin SDK",
          },
        ],
        required: true,
      });
      if (p.isCancel(selectedServices)) {
        p.cancel("Aborted.");
        process.exit(0);
      }
      componentOptions.selectedServices = selectedServices as string[];

      p.note(
        "Firebase client config — from Firebase console → Project Settings → Your apps",
        "Client SDK",
      );

      const apiKey = await p.text({
        message: "NEXT_PUBLIC_FIREBASE_API_KEY:",
        placeholder: "AIzaSy...",
        validate: required("API key"),
      });
      if (p.isCancel(apiKey)) process.exit(0);

      const authDomain = await p.text({
        message: "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN:",
        placeholder: "your-project.firebaseapp.com",
        validate: required("Auth domain"),
      });
      if (p.isCancel(authDomain)) process.exit(0);

      const projectId = await p.text({
        message: "NEXT_PUBLIC_FIREBASE_PROJECT_ID:",
        placeholder: "your-project-id",
        validate: required("Project ID"),
      });
      if (p.isCancel(projectId)) process.exit(0);

      const storageBucket = await p.text({
        message: "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET:",
        placeholder: "your-project.appspot.com",
        validate: required("Storage bucket"),
      });
      if (p.isCancel(storageBucket)) process.exit(0);

      const messagingSenderId = await p.text({
        message: "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID:",
        validate: required("Messaging sender ID"),
      });
      if (p.isCancel(messagingSenderId)) process.exit(0);

      const appId = await p.text({
        message: "NEXT_PUBLIC_FIREBASE_APP_ID:",
        placeholder: "1:123456789:web:abcdef",
        validate: required("App ID"),
      });
      if (p.isCancel(appId)) process.exit(0);

      p.note(
        "Firebase Admin config — from Firebase console → Project Settings → Service Accounts → Generate new private key",
        "Admin SDK",
      );

      const adminProjectId = await p.text({
        message: "FIREBASE_ADMIN_PROJECT_ID:",
        placeholder: "your-project-id",
        validate: required("Admin project ID"),
      });
      if (p.isCancel(adminProjectId)) process.exit(0);

      const adminClientEmail = await p.text({
        message: "FIREBASE_ADMIN_CLIENT_EMAIL:",
        placeholder: "firebase-adminsdk-xxx@your-project.iam.gserviceaccount.com",
        validate: required("Admin client email"),
      });
      if (p.isCancel(adminClientEmail)) process.exit(0);

      const adminPrivateKey = await p.password({
        message: "FIREBASE_ADMIN_PRIVATE_KEY (paste full PEM key including -----BEGIN/END----- lines):",
        validate: required("Admin private key"),
      });
      if (p.isCancel(adminPrivateKey)) process.exit(0);

      componentOptions.env["NEXT_PUBLIC_FIREBASE_API_KEY"] = apiKey as string;
      componentOptions.env["NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN"] = authDomain as string;
      componentOptions.env["NEXT_PUBLIC_FIREBASE_PROJECT_ID"] = projectId as string;
      componentOptions.env["NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET"] = storageBucket as string;
      componentOptions.env["NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID"] = messagingSenderId as string;
      componentOptions.env["NEXT_PUBLIC_FIREBASE_APP_ID"] = appId as string;
      componentOptions.env["FIREBASE_ADMIN_PROJECT_ID"] = adminProjectId as string;
      componentOptions.env["FIREBASE_ADMIN_CLIENT_EMAIL"] = adminClientEmail as string;
      componentOptions.env["FIREBASE_ADMIN_PRIVATE_KEY"] = adminPrivateKey as string;
    }

    if (component === "flutterwave") {
      p.note(
        "Provide your Flutterwave API keys from the Flutterwave dashboard (app.flutterwave.com).",
      );

      const secretKey = await p.password({
        message: "FLW_SECRET_KEY:",
        validate: required("Secret key"),
      });
      if (p.isCancel(secretKey)) process.exit(0);

      const publicKey = await p.text({
        message: "NEXT_PUBLIC_FLW_PUBLIC_KEY:",
        placeholder: "FLWPUBK_TEST-...",
        validate: required("Public key"),
      });
      if (p.isCancel(publicKey)) process.exit(0);

      const webhookSecret = await p.password({
        message:
          "FLW_WEBHOOK_SECRET (set in Flutterwave dashboard → Settings → Webhooks):",
        validate: required("Webhook secret"),
      });
      if (p.isCancel(webhookSecret)) process.exit(0);

      componentOptions.env["FLW_SECRET_KEY"] = secretKey as string;
      componentOptions.env["NEXT_PUBLIC_FLW_PUBLIC_KEY"] = publicKey as string;
      componentOptions.env["FLW_WEBHOOK_SECRET"] = webhookSecret as string;
    }

    if (component === "supabase") {
      const selectedServices = await p.multiselect({
        message: "Which Supabase services do you want to add?",
        options: [
          {
            value: "auth",
            label: "Auth",
            hint: "Email/password + OAuth sign-in, signOut, getUser, session middleware",
          },
          {
            value: "database",
            label: "Database",
            hint: "Typed query helpers (get, insert, update, delete, query) via service role",
          },
          {
            value: "storage",
            label: "Storage",
            hint: "File upload, signed URLs, bucket management",
          },
          {
            value: "realtime",
            label: "Realtime",
            hint: "Live table subscriptions and broadcast channels (client-side)",
          },
        ],
        required: true,
      });
      if (p.isCancel(selectedServices)) {
        p.cancel("Aborted.");
        process.exit(0);
      }
      componentOptions.selectedServices = selectedServices as string[];

      p.note(
        "From your Supabase project dashboard → Settings → API",
        "Supabase config",
      );

      const supabaseUrl = await p.text({
        message: "NEXT_PUBLIC_SUPABASE_URL:",
        placeholder: "https://xxxx.supabase.co",
        validate: required("Supabase URL"),
      });
      if (p.isCancel(supabaseUrl)) process.exit(0);

      const anonKey = await p.text({
        message: "NEXT_PUBLIC_SUPABASE_ANON_KEY:",
        placeholder: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
        validate: required("Anon key"),
      });
      if (p.isCancel(anonKey)) process.exit(0);

      const serviceRoleKey = await p.password({
        message:
          "SUPABASE_SERVICE_ROLE_KEY (server-only — never expose to client):",
        validate: required("Service role key"),
      });
      if (p.isCancel(serviceRoleKey)) process.exit(0);

      componentOptions.env["NEXT_PUBLIC_SUPABASE_URL"] = supabaseUrl as string;
      componentOptions.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] = anonKey as string;
      componentOptions.env["SUPABASE_SERVICE_ROLE_KEY"] =
        serviceRoleKey as string;

      if ((selectedServices as string[]).includes("auth")) {
        const siteUrl = await p.text({
          message:
            "NEXT_PUBLIC_SITE_URL (used for OAuth redirect, e.g. http://localhost:3000):",
          placeholder: "http://localhost:3000",
          validate: required("Site URL"),
        });
        if (p.isCancel(siteUrl)) process.exit(0);
        componentOptions.env["NEXT_PUBLIC_SITE_URL"] = siteUrl as string;
      }
    }

    if (component === "google-calendar") {
      p.note(
        "From Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client IDs.\nMake sure the Google Calendar API is enabled in your project.",
        "Google Calendar config",
      );

      const clientId = await p.text({
        message: "GOOGLE_CLIENT_ID:",
        placeholder: "123456789-xxx.apps.googleusercontent.com",
        validate: required("Client ID"),
      });
      if (p.isCancel(clientId)) process.exit(0);

      const clientSecret = await p.password({
        message: "GOOGLE_CLIENT_SECRET:",
        validate: required("Client secret"),
      });
      if (p.isCancel(clientSecret)) process.exit(0);

      const redirectUri = await p.text({
        message: "GOOGLE_REDIRECT_URI:",
        placeholder: "http://localhost:3000/api/auth/google-calendar/callback",
        validate: required("Redirect URI"),
      });
      if (p.isCancel(redirectUri)) process.exit(0);

      componentOptions.env["GOOGLE_CLIENT_ID"] = clientId as string;
      componentOptions.env["GOOGLE_CLIENT_SECRET"] = clientSecret as string;
      componentOptions.env["GOOGLE_REDIRECT_URI"] = redirectUri as string;
    }

    if (component === "calendly") {
      p.note(
        "From Calendly → Integrations → API & Webhooks → Personal Access Tokens.",
        "Calendly config",
      );

      const accessToken = await p.password({
        message: "CALENDLY_PERSONAL_ACCESS_TOKEN:",
        validate: required("Personal access token"),
      });
      if (p.isCancel(accessToken)) process.exit(0);

      const webhookSigningKey = await p.password({
        message:
          "CALENDLY_WEBHOOK_SIGNING_KEY (from Calendly → Integrations → Webhooks):",
        validate: required("Webhook signing key"),
      });
      if (p.isCancel(webhookSigningKey)) process.exit(0);

      componentOptions.env["CALENDLY_PERSONAL_ACCESS_TOKEN"] =
        accessToken as string;
      componentOptions.env["CALENDLY_WEBHOOK_SIGNING_KEY"] =
        webhookSigningKey as string;
    }

    if (component === "google-maps") {
      const selectedServices = await p.multiselect({
        message: "Which Google Maps services do you want to add?",
        options: [
          {
            value: "geocoding",
            label: "Geocoding",
            hint: "Convert addresses ↔ coordinates",
          },
          {
            value: "places",
            label: "Places",
            hint: "Search places, get details, autocomplete",
          },
          {
            value: "directions",
            label: "Directions",
            hint: "Get routes with steps and travel time",
          },
          {
            value: "distance-matrix",
            label: "Distance Matrix",
            hint: "Travel time/distance between multiple origins and destinations",
          },
          {
            value: "static-maps",
            label: "Static Maps",
            hint: "Generate map image URLs server-side",
          },
        ],
        required: true,
      });
      if (p.isCancel(selectedServices)) {
        p.cancel("Aborted.");
        process.exit(0);
      }
      componentOptions.selectedServices = selectedServices as string[];

      p.note(
        "From Google Cloud Console → APIs & Services → Credentials → API Keys.\nEnable each selected API in your project.",
        "Google Maps config",
      );

      const mapsApiKey = await p.password({
        message: "GOOGLE_MAPS_API_KEY:",
        validate: required("API key"),
      });
      if (p.isCancel(mapsApiKey)) process.exit(0);

      componentOptions.env["GOOGLE_MAPS_API_KEY"] = mapsApiKey as string;
    }

    if (component === "strapi") {
      p.note(
        "From your Strapi admin panel → Settings → API Tokens (for the API token)\nand Settings → Webhooks (to set the Authorization header value).",
        "Strapi config",
      );

      const strapiUrl = await p.text({
        message: "STRAPI_URL (your Strapi instance URL):",
        placeholder: "http://localhost:1337",
        validate: required("Strapi URL"),
      });
      if (p.isCancel(strapiUrl)) process.exit(0);

      const apiToken = await p.password({
        message: "STRAPI_API_TOKEN (Settings → API Tokens):",
        validate: required("API token"),
      });
      if (p.isCancel(apiToken)) process.exit(0);

      const webhookSecret = await p.password({
        message:
          "STRAPI_WEBHOOK_SECRET (the Authorization header value you set in Strapi → Webhooks):",
        validate: required("Webhook secret"),
      });
      if (p.isCancel(webhookSecret)) process.exit(0);

      componentOptions.env["STRAPI_URL"] = strapiUrl as string;
      componentOptions.env["STRAPI_API_TOKEN"] = apiToken as string;
      componentOptions.env["STRAPI_WEBHOOK_SECRET"] = webhookSecret as string;
    }

    if (component === "sanity") {
      p.note(
        "From your Sanity project dashboard → API → Tokens (for the API token)\nand API → Webhooks (to get the webhook secret).",
        "Sanity config",
      );

      const projectId = await p.text({
        message: "NEXT_PUBLIC_SANITY_PROJECT_ID:",
        placeholder: "abc12def",
        validate: required("Project ID"),
      });
      if (p.isCancel(projectId)) process.exit(0);

      const dataset = await p.text({
        message: "NEXT_PUBLIC_SANITY_DATASET (press Enter for \"production\"):",
        placeholder: "production",
      });
      if (p.isCancel(dataset)) process.exit(0);

      const apiToken = await p.password({
        message:
          "SANITY_API_TOKEN (leave blank if your dataset is publicly readable):",
      });
      if (p.isCancel(apiToken)) process.exit(0);

      const webhookSecret = await p.password({
        message:
          "SANITY_WEBHOOK_SECRET (the secret you set when creating the webhook):",
        validate: required("Webhook secret"),
      });
      if (p.isCancel(webhookSecret)) process.exit(0);

      componentOptions.env["NEXT_PUBLIC_SANITY_PROJECT_ID"] =
        projectId as string;
      componentOptions.env["NEXT_PUBLIC_SANITY_DATASET"] =
        (dataset as string).trim() || "production";
      if ((apiToken as string).trim()) {
        componentOptions.env["SANITY_API_TOKEN"] = apiToken as string;
      }
      componentOptions.env["SANITY_WEBHOOK_SECRET"] = webhookSecret as string;
    }

    if (component === "contentful") {
      p.note(
        "From your Contentful space → Settings → API Keys (for delivery/preview tokens)\nand Settings → Webhooks (to configure the x-contentful-secret header value).",
        "Contentful config",
      );

      const spaceId = await p.text({
        message: "CONTENTFUL_SPACE_ID:",
        placeholder: "abc12def34gh",
        validate: required("Space ID"),
      });
      if (p.isCancel(spaceId)) process.exit(0);

      const deliveryToken = await p.password({
        message: "CONTENTFUL_DELIVERY_TOKEN (Content Delivery API access token):",
        validate: required("Delivery token"),
      });
      if (p.isCancel(deliveryToken)) process.exit(0);

      const previewToken = await p.password({
        message:
          "CONTENTFUL_PREVIEW_TOKEN (Content Preview API token — leave blank to skip Draft Mode):",
      });
      if (p.isCancel(previewToken)) process.exit(0);

      const webhookSecret = await p.password({
        message:
          "CONTENTFUL_WEBHOOK_SECRET (the value you set as x-contentful-secret in Contentful → Webhooks):",
        validate: required("Webhook secret"),
      });
      if (p.isCancel(webhookSecret)) process.exit(0);

      componentOptions.env["CONTENTFUL_SPACE_ID"] = spaceId as string;
      componentOptions.env["CONTENTFUL_DELIVERY_TOKEN"] =
        deliveryToken as string;
      if ((previewToken as string).trim()) {
        componentOptions.env["CONTENTFUL_PREVIEW_TOKEN"] =
          previewToken as string;
      }
      componentOptions.env["CONTENTFUL_WEBHOOK_SECRET"] =
        webhookSecret as string;
    }

    if (component === "hygraph") {
      p.note(
        "From your Hygraph project → Project Settings → API Access.\nWebhook secret: Project Settings → Webhooks → Add Webhook → custom header value.",
        "Hygraph config",
      );

      const apiUrl = await p.text({
        message: "HYGRAPH_API_URL (Content API endpoint):",
        placeholder: "https://api-eu-west-2.hygraph.com/v2/xxx/master",
        validate: required("API URL"),
      });
      if (p.isCancel(apiUrl)) process.exit(0);

      const apiToken = await p.password({
        message:
          "HYGRAPH_API_TOKEN (leave blank if content is publicly readable):",
      });
      if (p.isCancel(apiToken)) process.exit(0);

      const previewUrl = await p.text({
        message: "HYGRAPH_PREVIEW_URL (leave blank to skip Draft Mode):",
        placeholder: "https://api-eu-west-2.hygraph.com/v2/xxx/master",
      });
      if (p.isCancel(previewUrl)) process.exit(0);

      const hygraphWebhookSecret = await p.password({
        message:
          "HYGRAPH_WEBHOOK_SECRET (the gcms-webhook-signature header value you set in Hygraph Webhooks):",
        validate: required("Webhook secret"),
      });
      if (p.isCancel(hygraphWebhookSecret)) process.exit(0);

      componentOptions.env["HYGRAPH_API_URL"] = apiUrl as string;
      if ((apiToken as string).trim()) {
        componentOptions.env["HYGRAPH_API_TOKEN"] = apiToken as string;
      }
      if ((previewUrl as string).trim()) {
        componentOptions.env["HYGRAPH_PREVIEW_URL"] = previewUrl as string;
      }
      componentOptions.env["HYGRAPH_WEBHOOK_SECRET"] =
        hygraphWebhookSecret as string;
    }

    if (component === "sendgrid") {
      p.note(
        "From your SendGrid account → Settings → API Keys.\nWebhook public key: Settings → Mail Settings → Event Webhooks → enable Signed Event Webhooks.",
        "SendGrid config",
      );

      const sgApiKey = await p.password({
        message: "SENDGRID_API_KEY:",
        validate: required("API key"),
      });
      if (p.isCancel(sgApiKey)) process.exit(0);

      const sgFromEmail = await p.text({
        message:
          "SENDGRID_FROM_EMAIL (verified sender address or \"Name <email>\"):",
        placeholder: "Acme <noreply@acme.dev>",
        validate: required("From email"),
      });
      if (p.isCancel(sgFromEmail)) process.exit(0);

      const sgWebhookPublicKey = await p.text({
        message:
          "SENDGRID_WEBHOOK_PUBLIC_KEY (PEM public key from Event Webhooks settings — leave blank to skip):",
        placeholder: "-----BEGIN PUBLIC KEY-----",
      });
      if (p.isCancel(sgWebhookPublicKey)) process.exit(0);

      componentOptions.env["SENDGRID_API_KEY"] = sgApiKey as string;
      componentOptions.env["SENDGRID_FROM_EMAIL"] = sgFromEmail as string;
      if ((sgWebhookPublicKey as string).trim()) {
        componentOptions.env["SENDGRID_WEBHOOK_PUBLIC_KEY"] =
          sgWebhookPublicKey as string;
      }
    }

    if (component === "neon") {
      p.note(
        "From your Neon project dashboard → Connection Details → Connection string.\nUse the pooled connection string for Prisma; direct connection for Drizzle/raw SQL.",
        "Neon config",
      );

      const databaseUrl = await p.password({
        message: "DATABASE_URL (Neon connection string):",
        validate: required("Database URL"),
      });
      if (p.isCancel(databaseUrl)) process.exit(0);

      const ormDefault =
        chosenORM === "prisma"
          ? "prisma"
          : chosenORM === "drizzle-orm"
            ? "drizzle"
            : "sql";

      const ormChoice = await p.select({
        message: "Which ORM are you using with Neon?",
        initialValue: ormDefault,
        options: [
          {
            value: "prisma",
            label: "Prisma",
            hint: "PrismaClient with @prisma/adapter-neon — WebSocket/pool mode",
          },
          {
            value: "drizzle",
            label: "Drizzle ORM",
            hint: "drizzle(neon(url)) — HTTP mode, fully Edge-compatible",
          },
          {
            value: "sql",
            label: "None / raw SQL",
            hint: "sql`` tagged template — no ORM, parameterized queries",
          },
        ],
      });
      if (p.isCancel(ormChoice)) {
        p.cancel("Aborted.");
        process.exit(0);
      }

      componentOptions.selectedServices = [ormChoice as string];
      componentOptions.env["DATABASE_URL"] = databaseUrl as string;
    }

    const displayComponent = component === "authjs" ? "auth" : component;

    const confirmInstall = await p.confirm({
      message: `Install ${pc.green(component)} into ${pc.cyan("./infra/" + displayComponent)}?`,
      initialValue: true,
    });

    if (p.isCancel(confirmInstall) || !confirmInstall) {
      p.cancel("Aborted.");
      process.exit(0);
    }

    const targetDir = path.join(
      projectRoot,
      basePath || "",
      "infra",
      displayComponent,
    );

    if (await fs.pathExists(targetDir)) {
      p.log.warn(
        `The ${pc.yellow(component)} component already exists in your project.`,
      );

      const overwrite = await p.confirm({
        message: pc.red(
          `Overwrite ./infra/${displayComponent}/? Other generated files (webhook routes, middleware, .env.local) will be re-written either way.`,
        ),
        initialValue: false,
      });

      if (p.isCancel(overwrite) || !overwrite) {
        p.cancel("Installation safely aborted. Your files were not changed.");
        process.exit(0);
      }
    }

    const installSpinner = p.spinner();
    installSpinner.start(`Generating files tailored for ${chosenORM}...`);
    let spinnerActive = true;

    let writtenForRollback: string[] = [];

    try {
      const result = await generateComponent(
        projectRoot,
        chosenORM,
        component,
        componentOptions,
      );
      writtenForRollback = result.writtenFiles ?? [];
      installSpinner.stop(pc.green("Files generated."));
      spinnerActive = false;

      if (result.dependencies && result.dependencies.length > 0) {
        const safeDeps = result.dependencies.filter((d: string) =>
          VALID_DEP_RE.test(d),
        );
        if (safeDeps.length !== result.dependencies.length) {
          throw new Error(
            "Registry returned one or more invalid dependency names. Aborting.",
          );
        }

        const depSpinner = p.spinner();
        const installArgs =
          pm === "npm"
            ? ["install", ...safeDeps, "--silent"]
            : ["add", ...safeDeps, "--silent"];

        depSpinner.start(`Installing dependencies via ${pm}...`);
        try {
          await execFileAsync(pm, installArgs, { cwd: projectRoot });
          depSpinner.stop(pc.green("Dependencies installed."));
        } catch (err: unknown) {
          depSpinner.stop(pc.red("Dependency install failed."));
          throw err;
        }
      }

      for (const w of result.warnings ?? []) {
        p.log.warn(w);
      }

      try {
        const lockPath = path.join(projectRoot, "infra.lock.json");
        type LockEntry = {
          installedAt: string;
          files: string[];
          dependencies: string[];
        };
        type LockFile = {
          version: number;
          components: Record<string, LockEntry>;
        };
        let lock: LockFile = { version: 1, components: {} };
        if (await fs.pathExists(lockPath)) {
          try {
            lock = await fs.readJson(lockPath);
            if (!lock.components) lock.components = {};
          } catch {}
        }
        lock.components[component] = {
          installedAt: new Date().toISOString(),
          files: (result.writtenFiles ?? []).map((f) =>
            path.relative(projectRoot, f),
          ),
          dependencies: result.dependencies,
        };
        await fs.outputJson(lockPath, lock, { spaces: 2 });
      } catch (err: unknown) {
        p.log.warn(
          `Failed to update infra.lock.json: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } catch (error: unknown) {
      if (spinnerActive) {
        installSpinner.stop(pc.red("Failed."));
        spinnerActive = false;
      }

      if (writtenForRollback.length > 0) {
        await Promise.allSettled(
          writtenForRollback.map((f) => fs.remove(f)),
        );
        p.log.info(
          `Rolled back ${writtenForRollback.length} file(s) written by the generator.`,
        );
      }

      p.cancel(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }

    p.outro(`🎉 ${pc.green(`${component} added successfully!`)}`);
  });

program.parse(process.argv);
