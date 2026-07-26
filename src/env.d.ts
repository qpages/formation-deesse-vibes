/// <reference types="astro/client" />

interface ImportMetaEnv {
	readonly DATABASE_URL?: string;
	readonly STRIPE_SECRET_KEY?: string;
	readonly STRIPE_WEBHOOK_SECRET?: string;
	readonly STRIPE_PRICE_ID?: string;
	readonly STRIPE_AMOUNT_CENTS?: string;
	readonly YOUSIGN_API_KEY?: string;
	readonly YOUSIGN_TEMPLATE_ID?: string;
	readonly YOUSIGN_WEBHOOK_SECRET?: string;
	readonly YOUSIGN_API_BASE?: string;
	readonly RESEND_API_KEY?: string;
	readonly RESEND_FROM?: string;
	readonly MAGIC_LINK_SECRET?: string;
	readonly SESSION_SECRET?: string;
	readonly PAYLOAD_ENCRYPTION_KEY?: string;
	readonly INNGEST_EVENT_KEY?: string;
	readonly INNGEST_SIGNING_KEY?: string;
	readonly MAKE_WEBHOOK_URL?: string;
	readonly SLACK_WEBHOOK_URL?: string;
	readonly ADMIN_EMAIL?: string;
	readonly ADMIN_PASSWORD?: string;
	readonly PUBLIC_SITE_URL?: string;
	readonly PUBLIC_ADMIN_CONTACT_EMAIL?: string;
	readonly PUBLIC_WHATSAPP_NUMBER?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
