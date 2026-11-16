// Secrets are optional so an unconfigured deployment fails closed with a useful 503.
interface Env {
  JWT_SECRET?: string;
  TURNSTILE_SECRET_KEY?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  EMAIL_FROM?: string;
  EMAIL_REPLY_TO?: string;
}
