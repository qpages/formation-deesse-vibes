export type DocusealWebhookPayload = {
	event_type?: string;
	timestamp?: string;
	data?: {
		id?: number;
		submission_id?: number;
		external_id?: string | null;
		completed_at?: string | null;
		submitters?: Array<{ external_id?: string | null }>;
		submission?: {
			id?: number;
			external_id?: string | null;
			status?: string;
			completed_at?: string | null;
		};
	};
};
