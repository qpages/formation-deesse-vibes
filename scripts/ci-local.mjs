#!/usr/bin/env node
/**
 * Same checks as GitHub Actions CI (no e2e, no deploy).
 * Usage: pnpm ci:local
 */
import { spawnSync } from 'node:child_process';

/** Prisma 7 loads prisma.config.ts, which requires a URL even for `validate`. */
const prismaEnv = {
	...process.env,
	DEV_DATABASE_URL: process.env.DEV_DATABASE_URL?.trim() || 'postgresql://ci:ci@127.0.0.1:5432/ci',
};

const steps = [
	['prettier', ['pnpm', 'format:check']],
	['eslint', ['pnpm', 'lint']],
	['prisma validate', ['pnpm', 'db:validate'], prismaEnv],
	['astro check', ['pnpm', 'check']],
	['vitest', ['pnpm', 'test']],
];

for (const [name, [cmd, ...args], env] of steps) {
	console.log(`\n== ${name} ==`);
	const result = spawnSync(cmd, args, {
		stdio: 'inherit',
		shell: process.platform === 'win32',
		env: env ?? process.env,
	});
	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

console.log('\nCI local: ok');
