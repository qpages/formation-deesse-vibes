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

export function getPrisma(): PrismaClient {
	if (!globalForPrisma.prisma) {
		globalForPrisma.prisma = createClient();
	}
	return globalForPrisma.prisma;
}

export type { Enrollment, EnrollmentStatus } from '../generated/prisma/client';
