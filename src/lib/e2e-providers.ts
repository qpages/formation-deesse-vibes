/** Server-side stubs for Playwright. Never enabled in production deploys. */
export function e2eMockProviders(): boolean {
	return process.env.E2E_MOCK_PROVIDERS === '1';
}
