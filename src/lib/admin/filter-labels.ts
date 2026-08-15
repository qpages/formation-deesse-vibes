import type { AccessStatus, CollectionStatus, ContractStatus } from '../../generated/prisma/client';
import { ACCESS_STATUS_LABELS, COLLECTION_STATUS_LABELS, CONTRACT_STATUS_LABELS } from '../status';
import { adminListHref } from './enrollments';

export type ActiveFilterChip = { label: string; href: string };

export function activeFilterChips(input: {
	q: string;
	collection: CollectionStatus | '';
	contract: ContractStatus | '';
	access: AccessStatus | '';
}): ActiveFilterChip[] {
	const chips: ActiveFilterChip[] = [];

	if (input.collection) {
		chips.push({
			label: `Paiement : ${COLLECTION_STATUS_LABELS[input.collection]}`,
			href: adminListHref({ ...input, collection: '' }),
		});
	}
	if (input.contract) {
		chips.push({
			label: `Signature : ${CONTRACT_STATUS_LABELS[input.contract]}`,
			href: adminListHref({ ...input, contract: '' }),
		});
	}
	if (input.access) {
		chips.push({
			label: `Accès : ${ACCESS_STATUS_LABELS[input.access]}`,
			href: adminListHref({ ...input, access: '' }),
		});
	}

	return chips;
}
