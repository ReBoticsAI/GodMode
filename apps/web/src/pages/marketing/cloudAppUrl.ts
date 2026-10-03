/** SaaS app origin for marketing CTAs when hosted on Pages (apex/www). */
export const CLOUD_APP_ORIGIN =
  (import.meta.env.VITE_CLOUD_APP_ORIGIN as string | undefined)?.replace(/\/$/, "") ||
  "https://app.godmode.software";

export const CLOUD_APP_HOME = `${CLOUD_APP_ORIGIN}/`;
/** Opens AuthGate on the Graph (temporary visitors stay on the canvas). */
export const CLOUD_APP_LOGIN = `${CLOUD_APP_ORIGIN}/?auth=1`;
/** Opens AuthGate signup / plan picker (`auth=1` + `signup=1`). */
export const CLOUD_APP_SIGNUP = `${CLOUD_APP_ORIGIN}/?auth=1&signup=1`;
