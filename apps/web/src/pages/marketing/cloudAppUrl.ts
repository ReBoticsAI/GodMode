/** SaaS app origin for marketing CTAs when hosted on Pages (apex/www). */
export const CLOUD_APP_ORIGIN =
  (import.meta.env.VITE_CLOUD_APP_ORIGIN as string | undefined)?.replace(/\/$/, "") ||
  "https://app.godmode.software";

export const CLOUD_APP_HOME = `${CLOUD_APP_ORIGIN}/`;
export const CLOUD_APP_LOGIN = `${CLOUD_APP_ORIGIN}/login`;
