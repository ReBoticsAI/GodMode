import { SELLER_LINK_STATE_KEY } from "@/pages/SellerLinkConnect";
import { SELLER_GITHUB_STATE_KEY } from "@/pages/SellerLinkGithub";
import { SELLER_STRIPE_STATE_KEY } from "@/pages/SellerLinkStripe";

/** Pending Local Sell redirect path stored during Cloud sign-in (#709 / #711). */
export function readSellerLinkResumePath(): string | null {
  try {
    const stripe = sessionStorage.getItem(SELLER_STRIPE_STATE_KEY)?.trim();
    if (stripe) {
      return `/seller-link/stripe?state=${encodeURIComponent(stripe)}`;
    }
    const github = sessionStorage.getItem(SELLER_GITHUB_STATE_KEY)?.trim();
    if (github) {
      return `/seller-link/github?state=${encodeURIComponent(github)}`;
    }
    const link = sessionStorage.getItem(SELLER_LINK_STATE_KEY)?.trim();
    if (link) {
      return `/seller-link/connect?state=${encodeURIComponent(link)}`;
    }
  } catch {
    /* private mode */
  }
  return null;
}

export function isSellerLinkPath(pathname: string): boolean {
  return (
    pathname.startsWith("/seller-link/connect") ||
    pathname.startsWith("/seller-link/github") ||
    pathname.startsWith("/seller-link/stripe")
  );
}
