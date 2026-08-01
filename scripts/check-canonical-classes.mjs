#!/usr/bin/env node
/**
 * Fails if any Tailwind class in src/ is non-canonical
 * (same suggestions as IntelliSense `suggestCanonicalClasses`).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { __unstable__loadDesignSystem } from '@tailwindcss/node';

const root = fileURLToPath(new URL('..', import.meta.url));
const cssPath = join(root, 'src/styles/global.css');
const css = readFileSync(cssPath, 'utf8');
const ds = await __unstable__loadDesignSystem(css, { base: join(root, 'src/styles') });

function walk(dir, out = []) {
	for (const name of readdirSync(dir)) {
		if (name === 'node_modules' || name === 'dist' || name === '.git') continue;
		const p = join(dir, name);
		const s = statSync(p);
		if (s.isDirectory()) walk(p, out);
		else if (/\.(astro|tsx|jsx|ts|js|css|html|vue|svelte|mdx)$/.test(name)) out.push(p);
	}
	return out;
}

const files = walk(join(root, 'src'));
const issues = [];

for (const file of files) {
	const text = readFileSync(file, 'utf8');
	const candidates = new Set();

	for (const m of text.matchAll(/['"`]([^'"`]{2,})['"`]/g)) {
		const s = m[1];
		if (s.includes('/') && !s.includes(' ')) continue;
		if (s.includes('http') || (s.includes('@') && !s.includes(' '))) continue;
		if (s.includes('.') && !s.includes(' ') && !s.includes('[')) continue;

		const parts = s.split(/\s+/).filter(Boolean);
		if (parts.length === 0) continue;
		if (!parts.some((p) => /^[!@]?[a-z0-9[\]()./%:_-]+$/i.test(p) && /[a-z]/.test(p))) continue;

		for (const p of parts) {
			if (p.length < 2 || /^[A-Z]/.test(p)) continue;
			candidates.add(p);
		}
	}

	for (const c of candidates) {
		try {
			const [canon] = ds.canonicalizeCandidates([c]);
			if (canon && canon !== c) {
				issues.push({
					file: relative(root, file),
					from: c,
					to: canon,
				});
			}
		} catch {
			// ignore unparsable tokens
		}
	}
}

if (issues.length === 0) {
	console.log('OK: all Tailwind classes are canonical.');
	process.exit(0);
}

const map = new Map();
for (const i of issues) {
	const key = `${i.from} => ${i.to}`;
	if (!map.has(key)) map.set(key, { ...i, files: new Set() });
	map.get(key).files.add(i.file);
}

console.error(`Found ${map.size} non-canonical Tailwind class(es):\n`);
for (const i of [...map.values()].sort((a, b) => a.from.localeCompare(b.from))) {
	console.error(`  ${i.from}  →  ${i.to}`);
	console.error(`    in: ${[...i.files].join(', ')}`);
}
console.error('\nFix with the suggested class, then re-run: npm run check:tailwind');
process.exit(1);
