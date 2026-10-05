import fs from "fs-extra";
import path from "path";
// Infers package manager, ORM, router type and src/ layout from the project files.
export async function detectEnvironment(projectRoot) {
    const pkgPath = path.join(projectRoot, "package.json");
    if (!(await fs.pathExists(pkgPath))) {
        throw new Error("Could not find package.json. Are you in the root of your project?");
    }
    const pkg = await fs.readJson(pkgPath);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const [hasPnpm, hasBun, hasYarn, hasNpm, hasAppRoot, hasAppSrc, hasSrc] = await Promise.all([
        fs.pathExists(path.join(projectRoot, "pnpm-lock.yaml")),
        fs.pathExists(path.join(projectRoot, "bun.lockb")),
        fs.pathExists(path.join(projectRoot, "yarn.lock")),
        fs.pathExists(path.join(projectRoot, "package-lock.json")),
        fs.pathExists(path.join(projectRoot, "app")),
        fs.pathExists(path.join(projectRoot, "src", "app")),
        fs.pathExists(path.join(projectRoot, "src")),
    ]);
    let packageManager = "npm";
    if (hasPnpm)
        packageManager = "pnpm";
    else if (hasBun)
        packageManager = "bun";
    else if (hasYarn)
        packageManager = "yarn";
    else if (hasNpm)
        packageManager = "npm";
    let orm = "UNKNOWN";
    if (deps["prisma"] || deps["@prisma/client"])
        orm = "prisma";
    else if (deps["drizzle-orm"])
        orm = "drizzle-orm";
    else if (deps["sequelize"])
        orm = "sequelize";
    else if (deps["typeorm"])
        orm = "typeorm";
    else if (deps["@mikro-orm/core"])
        orm = "mikro-orm";
    else if (deps["objection"])
        orm = "objection";
    else if (deps["knex"])
        orm = "knex";
    return {
        orm,
        packageManager,
        isAppRouter: hasAppRoot || hasAppSrc,
        basePath: hasSrc ? "src" : "",
        tailwind: !!deps["tailwindcss"],
    };
}
