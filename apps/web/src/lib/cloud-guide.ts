import {
  cancelGraphTour,
  GRAPH_TOUR_DWELL_MS,
  GRAPH_TOUR_LINE_EVENT,
} from "@/lib/guide-ui-action";
import { CLOUD_APP_SIGNUP } from "@/pages/marketing/cloudAppUrl";

/** Published Cloud prices from the marketing pricing page. */
export const CLOUD_MONTHLY_PRICE = "$9.99";
export const CLOUD_YEARLY_PRICE = "$74.99";
export const CLOUD_SIGNUP_URL = CLOUD_APP_SIGNUP;

export const CLOUD_GUIDE_OPEN_EVENT = "godmode:cloud-guide-open";
export const CLOUD_GUIDE_SECTION_EVENT = "godmode:cloud-guide-section";
export const CLOUD_GUIDE_DONE_EVENT = "godmode:cloud-guide-done";

export type CloudGuideStop = {
  id: string;
  title: string;
  say: string;
};

/**
 * Fixed walk of the Cloud signup page.
 * The window shows the page. Chat explains the section in view.
 */
export const CLOUD_GUIDE_STOPS: CloudGuideStop[] = [
  {
    id: "workspace",
    title: "Hosted workspace",
    say: "GodMode Cloud hosts the workspace. You sign in from any device, and you are not running GodMode on this machine.",
  },
  {
    id: "monthly",
    title: "Cloud Monthly",
    say: `Cloud Monthly is ${CLOUD_MONTHLY_PRICE} per month. You pick the plan, pay, then create the account. Cancel anytime from the billing portal.`,
  },
  {
    id: "yearly",
    title: "Cloud Yearly",
    say: `Cloud Yearly is ${CLOUD_YEARLY_PRICE}. That is a lower total than twelve monthly payments, about 4.5 months of savings.`,
  },
  {
    id: "keys",
    title: "Model keys",
    say: "Cloud is the hosted workspace. You can bring your own model keys. If you want GodMode to supply the models too, that is Cloud with Inference, a separate choice.",
  },
  {
    id: "signup",
    title: "Signup",
    say: "This page is the signup. Continue to GodMode Cloud, choose Monthly or Yearly, pay, then create the account and verify email.",
  },
];

/** Open the Cloud signup window and narrate it. No model call. */
export function playCloudGuide(dwellMs = GRAPH_TOUR_DWELL_MS): void {
  cancelGraphTour();
  if (typeof window === "undefined") return;
  const wait = Math.min(20_000, Math.max(1_000, dwellMs));
  const timers: number[] = [];
  const onReset = () => {
    for (const id of timers) window.clearTimeout(id);
    window.removeEventListener("godmode:graph-tour-reset", onReset);
  };
  window.addEventListener("godmode:graph-tour-reset", onReset);
  window.dispatchEvent(new CustomEvent(CLOUD_GUIDE_OPEN_EVENT));
  const show = (stop: CloudGuideStop) => {
    window.dispatchEvent(
      new CustomEvent(CLOUD_GUIDE_SECTION_EVENT, { detail: { id: stop.id } })
    );
    window.dispatchEvent(
      new CustomEvent(GRAPH_TOUR_LINE_EVENT, {
        detail: { label: stop.title, say: stop.say },
      })
    );
  };
  show(CLOUD_GUIDE_STOPS[0]);
  for (let i = 1; i < CLOUD_GUIDE_STOPS.length; i++) {
    const stop = CLOUD_GUIDE_STOPS[i];
    timers.push(window.setTimeout(() => show(stop), i * wait));
  }
  timers.push(
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent(CLOUD_GUIDE_DONE_EVENT));
    }, CLOUD_GUIDE_STOPS.length * wait)
  );
}
