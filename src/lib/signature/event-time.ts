type EventTimePayload = {
	event_time?: string | number;
};

/** Parse Yousign webhook event_time (epoch seconds/ms or ISO string). */
export function eventOccurredAt(payload: EventTimePayload): Date {
	const raw = payload.event_time;
	if (typeof raw === 'number') {
		return new Date(raw > 1e12 ? raw : raw * 1000);
	}
	if (typeof raw === 'string' && raw.trim()) {
		const asNumber = Number(raw);
		if (!Number.isNaN(asNumber)) {
			return new Date(asNumber > 1e12 ? asNumber : asNumber * 1000);
		}
		const parsed = new Date(raw);
		if (!Number.isNaN(parsed.getTime())) return parsed;
	}
	return new Date();
}
