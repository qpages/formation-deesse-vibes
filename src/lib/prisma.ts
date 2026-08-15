import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { resolveDatabaseUrl } from './database-url';

const PRISMA_CLIENT_REV = 'yousignLastError';

const globalForPrisma = globalThis as unknown as {
	prisma?: PrismaClient;
	prismaRev?: string;
};

function createClient() {
	const connectionString = resolveDatabaseUrl();
	const adapter = new PrismaPg({ connectionString });
	return new PrismaClient({ adapter });
}

/** Drop HMR-cached clients that predate a `prisma generate` (missing new models/fields). */
function isClientCurrent(client: PrismaClient): boolean {
	return (
		globalForPrisma.prismaRev === PRISMA_CLIENT_REV &&
		typeof client.payment?.findMany === 'function' &&
		typeof client.user?.findMany === 'function' &&
		typeof client.providerEvent?.findMany === 'function'
	);
}

export function getPrisma(): PrismaClient {
	if (!globalForPrisma.prisma || !isClientCurrent(globalForPrisma.prisma)) {
		globalForPrisma.prisma = createClient();
		globalForPrisma.prismaRev = PRISMA_CLIENT_REV;
	}
	return globalForPrisma.prisma;
}

export type { Enrollment } from '../generated/prisma/client';
