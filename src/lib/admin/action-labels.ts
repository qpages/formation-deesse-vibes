import { ADMIN_ACTIONS, type AdminActionKey, adminActionKeys } from './actions';

const labels = Object.fromEntries(
	ADMIN_ACTIONS.map((a) => [a.action, a.label]),
) as Record<AdminActionKey, string>;

export function adminActionLabel(action: string): string {
	if ((adminActionKeys as readonly string[]).includes(action)) {
		return labels[action as AdminActionKey];
	}
	return action;
}
