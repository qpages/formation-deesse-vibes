#!/usr/bin/env node
/**
 * Same checks as GitHub Actions CI (no e2e, no deploy).
 * Usage: pnpm ci:local
 */
import { spawnSync } from 'node:child_process';

const steps = [
	['prettier', ['pnpm', 'format:check']],
	['eslint', ['pnpm', 'lint']],
	['prisma validate', ['pnpm', 'db:validate']],
	['astro check', ['pnpm', 'check']],
	['vitest', ['pnpm', 'test']],
];

for (const [name, [cmd, ...args]] of steps) {
	console.log(`\n== ${name} ==`);
	const result = spawnSync(cmd, args, {
		stdio: 'inherit',
		shell: process.platform === 'win32',
		env: process.env,
	});
	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

console.log('\nCI local: ok');
