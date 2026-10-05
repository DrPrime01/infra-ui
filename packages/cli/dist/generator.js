import fs from "fs-extra";
import path from "path";
import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
const execFileAsync = promisify(execFile);
const providerCasing = {
    google: "Google",
    github: "GitHub",
    facebook: "Facebook",
    discord: "Discord",
};
const DEFAULT_REGISTRY_BASE = "https://raw.githubusercontent.com/DrPrime01/infra-ui/refs/heads/main/packages/registry";
const REGISTRY_BASE = process.env.INFRA_REGISTRY_BASE ?? DEFAULT_REGISTRY_BASE;
const MAX_PAYLOAD_BYTES = 1_000_000;
// Rejects paths that escape the project root via `..` traversal or symlinked ancestors.
async function assertSafePath(targetPath, realRoot) {
    const resolvedTarget = path.resolve(targetPath);
    if (resolvedTarget !== realRoot &&
        !resolvedTarget.startsWith(realRoot + path.sep)) {
        throw new Error(`Refusing to write outside project root: ${resolvedTarget}`);
    }
    let cursor = path.dirname(resolvedTarget);
    while (cursor !== path.dirname(cursor)) {
        try {
            const realCursor = await fs.realpath(cursor);
            if (realCursor !== realRoot &&
                !realCursor.startsWith(realRoot + path.sep)) {
                throw new Error(`Path escapes project root via symlink: ${cursor} → ${realCursor}`);
            }
            return;
        }
        catch (err) {
            const code = err.code;
            if (code === "ENOENT") {
                cursor = path.dirname(cursor);
                continue;
            }
            throw err;
        }
    }
}
// Streams the registry JSON under a size cap and verifies optional per-file sha256 integrity.
async function fetchRegistry(component) {
    const url = `${REGISTRY_BASE}/${component}.json`;
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
        throw new Error(`Failed to fetch component registry (${url}). Status: ${response.status}`);
    }
    if (!response.body) {
        throw new Error("Registry response had no body.");
    }
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    let streamCompleted = false;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done)
                break;
            received += value.length;
            if (received > MAX_PAYLOAD_BYTES) {
                throw new Error(`Registry payload exceeded ${MAX_PAYLOAD_BYTES} bytes; aborting.`);
            }
            chunks.push(value);
        }
        streamCompleted = true;
    }
    finally {
        if (!streamCompleted) {
            await reader.cancel().catch(() => { });
        }
    }
    const text = Buffer.concat(chunks).toString("utf-8");
    const payload = JSON.parse(text);
    if (payload.integrity && typeof payload.integrity === "object") {
        const integrity = payload.integrity;
        const files = (payload.files ?? {});
        for (const [name, expected] of Object.entries(integrity)) {
            const content = files[name];
            if (typeof content !== "string") {
                throw new Error(`Integrity declared for "${name}" but file missing.`);
            }
            const actual = "sha256-" +
                crypto.createHash("sha256").update(content).digest("base64");
            if (actual !== expected) {
                throw new Error(`Integrity check failed for "${name}". Expected ${expected}, got ${actual}.`);
            }
        }
    }
    return payload;
}
// Returns true if git ignores the path, false if not, and null if git can't tell.
async function isGitIgnored(relPath, cwd) {
    try {
        await execFileAsync("git", ["check-ignore", "-q", relPath], { cwd });
        return true;
    }
    catch (err) {
        const code = err.code;
        if (code === 1 || code === "1")
            return false;
        return null;
    }
}
// Writes a file then chmods it, since writeFile's `mode` only applies when creating.
async function writeFileAtomic(target, content, mode) {
    await fs.ensureDir(path.dirname(target));
    if (mode !== undefined) {
        await fs.writeFile(target, content, { mode });
        try {
            await fs.chmod(target, mode);
        }
        catch { }
    }
    else {
        await fs.writeFile(target, content);
    }
}
// Writes a component's files, middleware, env vars and deps, rolling back on failure.
export async function generateComponent(projectRoot, orm, component, options) {
    const rawPayload = (await fetchRegistry(component));
    let payload;
    if (rawPayload.serviceFiles &&
        typeof rawPayload.serviceFiles === "object" &&
        options?.selectedServices &&
        options.selectedServices.length > 0) {
        const sharedFiles = (rawPayload.sharedFiles ?? {});
        const serviceFilesMap = rawPayload.serviceFiles;
        const assembledFiles = { ...sharedFiles };
        let assembledMiddleware;
        for (const svc of options.selectedServices) {
            const svcDef = serviceFilesMap[svc];
            if (!svcDef)
                continue;
            Object.assign(assembledFiles, svcDef.files ?? {});
            if (svcDef.middlewareTemplates)
                assembledMiddleware = svcDef.middlewareTemplates;
        }
        payload = {
            ...rawPayload,
            files: assembledFiles,
            ...(assembledMiddleware ? { middlewareTemplates: assembledMiddleware } : {}),
        };
    }
    else {
        payload = rawPayload;
    }
    const realRoot = await fs.realpath(projectRoot);
    const hasSrcDirectory = await fs.pathExists(path.join(realRoot, "src"));
    const baseDir = hasSrcDirectory ? "src" : "";
    const rootTargetDir = path.join(realRoot, baseDir);
    const infraComponentName = component === "authjs" ? "auth" : component;
    const infraDir = path.join(realRoot, baseDir, "infra", infraComponentName);
    const isAppRouter = options?.isAppRouter ?? true;
    const warnings = [];
    const plannedWrites = [];
    const plan = async (target, content) => {
        await assertSafePath(target, realRoot);
        plannedWrites.push({ target, content });
    };
    const files = (payload.files ?? {});
    for (const [fileName, rawContent] of Object.entries(files)) {
        let fileContent = rawContent;
        if (fileName.includes("/")) {
            if (fileName.startsWith("app/") && !isAppRouter)
                continue;
            if (fileName.startsWith("pages/") && isAppRouter)
                continue;
            await plan(path.join(rootTargetDir, fileName), fileContent);
            continue;
        }
        if (fileName === "auth.ts" && component === "authjs") {
            let imports = "";
            let array = "";
            const providers = options?.providers ?? [];
            providers.forEach((p) => {
                const properName = providerCasing[p] ?? p;
                imports += `import ${properName} from "next-auth/providers/${p}";\n`;
                array += `    ${properName},\n`;
            });
            fileContent = fileContent
                .replace("{{PROVIDER_IMPORTS}}", imports.trim())
                .replace("{{PROVIDER_ARRAY}}", array.trimEnd());
            await plan(path.join(rootTargetDir, fileName), fileContent);
        }
        else if (fileName === "route.ts" && component === "authjs") {
            const apiDir = path.join(rootTargetDir, "app", "api", "auth", "[...nextauth]");
            await plan(path.join(apiDir, fileName), fileContent);
        }
        else if (fileName === "route.ts") {
            const apiDir = path.join(rootTargetDir, "app", "api", "webhooks", component);
            await plan(path.join(apiDir, fileName), fileContent);
        }
        else {
            await plan(path.join(infraDir, fileName), fileContent);
        }
    }
    const adapters = payload.adapters;
    if (adapters) {
        const adapterContent = adapters[orm] ?? adapters["manual"];
        if (adapterContent === undefined) {
            warnings.push(`${component}: no adapter for ORM "${orm}" and no "manual" fallback in registry. Skipping adapter.ts — you'll need to write your own.`);
        }
        else {
            if (!adapters[orm] && adapters["manual"]) {
                warnings.push(`No ${orm} adapter for ${component}; using "manual" placeholder. Implement the adapter before going to production.`);
            }
            await plan(path.join(infraDir, "adapter.ts"), adapterContent);
        }
    }
    const middlewareTemplates = payload.middlewareTemplates;
    let middlewareWrite = null;
    if (middlewareTemplates) {
        let nextVersion = 16;
        try {
            const userPkg = await fs.readJson(path.join(realRoot, "package.json"));
            const rawVersion = userPkg.dependencies?.next ?? userPkg.devDependencies?.next ?? "16.0.0";
            const cleanVersion = String(rawVersion).replace(/[^0-9.]/g, "");
            nextVersion = parseInt(cleanVersion.split(".")[0], 10);
            if (Number.isNaN(nextVersion))
                nextVersion = 16;
        }
        catch { }
        const isNext16 = nextVersion >= 16;
        const interceptorFileName = isNext16 ? "proxy.ts" : "middleware.ts";
        const interceptorPath = path.join(rootTargetDir, interceptorFileName);
        const templateKey = isNext16 ? "proxy" : "legacy";
        const baseTemplate = middlewareTemplates[templateKey];
        if (typeof baseTemplate !== "string" || baseTemplate.length === 0) {
            warnings.push(`${component}: no middleware template for "${templateKey}" (Next ${nextVersion}). Skipping middleware write.`);
        }
        else {
            await assertSafePath(interceptorPath, realRoot);
            if (await fs.pathExists(interceptorPath)) {
                const existingContent = await fs.readFile(interceptorPath, "utf-8");
                const authImportRe = /from\s+['"]\.\/auth['"]/;
                const clerkCallRe = /clerkMiddleware\s*\(/;
                if (component === "authjs" && !authImportRe.test(existingContent)) {
                    middlewareWrite = {
                        target: interceptorPath,
                        content: `import { auth } from "./auth";\n${existingContent}`,
                    };
                }
                else if (component === "clerk" &&
                    !clerkCallRe.test(existingContent)) {
                    const sidecarPath = path.join(rootTargetDir, `${path.basename(interceptorFileName, ".ts")}.clerk.example.ts`);
                    await assertSafePath(sidecarPath, realRoot);
                    middlewareWrite = { target: sidecarPath, content: baseTemplate };
                    warnings.push(`Existing ${interceptorFileName} detected — Clerk template written to ${path.basename(sidecarPath)} instead. Merge manually.`);
                }
                else if (component === "firebase" &&
                    !/from\s+['"]@\/infra\/firebase\/auth-server['"]/.test(existingContent)) {
                    const sidecarPath = path.join(rootTargetDir, `${path.basename(interceptorFileName, ".ts")}.firebase.example.ts`);
                    await assertSafePath(sidecarPath, realRoot);
                    middlewareWrite = { target: sidecarPath, content: baseTemplate };
                    warnings.push(`Existing ${interceptorFileName} detected — Firebase template written to ${path.basename(sidecarPath)} instead. Merge manually.`);
                }
                else if (component === "supabase" &&
                    !/from\s+['"]@\/infra\/supabase['"]/.test(existingContent)) {
                    const sidecarPath = path.join(rootTargetDir, `${path.basename(interceptorFileName, ".ts")}.supabase.example.ts`);
                    await assertSafePath(sidecarPath, realRoot);
                    middlewareWrite = { target: sidecarPath, content: baseTemplate };
                    warnings.push(`Existing ${interceptorFileName} detected — Supabase template written to ${path.basename(sidecarPath)} instead. Merge manually.`);
                }
            }
            else {
                middlewareWrite = { target: interceptorPath, content: baseTemplate };
            }
        }
    }
    if (middlewareWrite) {
        plannedWrites.push(middlewareWrite);
    }
    const writtenFiles = [];
    const results = await Promise.allSettled(plannedWrites.map(async (w) => {
        writtenFiles.push(w.target);
        await writeFileAtomic(w.target, w.content);
    }));
    const firstFailure = results.find((r) => r.status === "rejected");
    if (firstFailure) {
        await Promise.allSettled(writtenFiles.map((f) => fs.remove(f)));
        throw firstFailure.reason;
    }
    if (options?.env && Object.keys(options.env).length > 0) {
        const envLocalPath = path.join(realRoot, ".env.local");
        await assertSafePath(envLocalPath, realRoot);
        let envContent = "";
        if (await fs.pathExists(envLocalPath)) {
            envContent = await fs.readFile(envLocalPath, "utf-8");
            if (!envContent.endsWith("\n"))
                envContent += "\n";
        }
        else {
            envContent = "# Make sure this file is listed in your .gitignore!\n";
        }
        const sectionHeader = payload.envSectionHeader ??
            `# ${component} Configuration`;
        envContent += `\n${sectionHeader}\n`;
        for (const [key, value] of Object.entries(options.env)) {
            const safeValue = (value ?? "")
                .replace(/\\/g, "\\\\")
                .replace(/"/g, '\\"');
            envContent += `${key}="${safeValue}"\n`;
        }
        await writeFileAtomic(envLocalPath, envContent, 0o600);
        writtenFiles.push(envLocalPath);
        const ignored = await isGitIgnored(".env.local", realRoot);
        if (ignored === false) {
            warnings.push(".env.local is NOT ignored by git — secrets could be committed.");
        }
        else if (ignored === null) {
            warnings.push("Couldn't verify .env.local is gitignored (not a git repo or git unavailable). Make sure it is before committing.");
        }
    }
    const baseDeps = (payload.dependencies ?? []).slice();
    const rawConditional = payload.conditionalDeps;
    const conditional = [];
    if (Array.isArray(rawConditional)) {
        for (const rule of rawConditional) {
            const shapeOk = rule &&
                typeof rule === "object" &&
                rule.when &&
                typeof rule.when === "object" &&
                Array.isArray(rule.deps) &&
                rule.deps.every((d) => typeof d === "string");
            const ormInOk = rule?.when?.ormIn === undefined ||
                (Array.isArray(rule.when.ormIn) &&
                    rule.when.ormIn.every((s) => typeof s === "string"));
            const routerOk = rule?.when?.isAppRouter === undefined ||
                typeof rule.when.isAppRouter === "boolean";
            if (shapeOk && ormInOk && routerOk) {
                conditional.push(rule);
            }
            else {
                warnings.push("Skipping a malformed conditionalDeps rule.");
            }
        }
    }
    else if (rawConditional !== undefined) {
        warnings.push("conditionalDeps was not an array; ignoring.");
    }
    for (const rule of conditional) {
        const ormMatch = !rule.when.ormIn || rule.when.ormIn.includes(orm);
        const routerMatch = rule.when.isAppRouter === undefined ||
            rule.when.isAppRouter === isAppRouter;
        if (!ormMatch || !routerMatch)
            continue;
        for (const dep of rule.deps) {
            if (dep.includes("{{orm}}")) {
                const ormStr = orm;
                if (ormStr === "UNKNOWN" || ormStr === "manual") {
                    warnings.push(`Skipping conditional dep "${dep}" — no concrete ORM detected (got "${ormStr}").`);
                    continue;
                }
                baseDeps.push(dep.replace(/\{\{orm\}\}/g, ormStr));
            }
            else {
                baseDeps.push(dep);
            }
        }
    }
    return {
        dependencies: baseDeps,
        warnings,
        writtenFiles,
    };
}
