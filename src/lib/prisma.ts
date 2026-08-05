import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
	const connectionString = import.meta.env.DATABASE_URL ?? process.env.DATABASE_URL;
	if (!connectionString) {
		throw new Error('DATABASE_URL is required');
	}
	const adapter = new PrismaPg({ connectionString });
	return new PrismaClient({ adapter });
}

/** Drop HMR-cached clients that predate a `prisma generate` (missing new models). */
function isClientCurrent(client: PrismaClient): boolean {
	return (
		typeof client.payment?.findMany === 'function' &&
		typeof client.user?.findMany === 'function' &&
		typeof client.providerEvent?.findMany === 'function'
	);
}

export function getPrisma(): PrismaClient {
	if (!globalForPrisma.prisma || !isClientCurrent(globalForPrisma.prisma)) {
		globalForPrisma.prisma = createClient();
	}
	return globalForPrisma.prisma;
}

export type { Enrollment } from '../generated/prisma/client';
