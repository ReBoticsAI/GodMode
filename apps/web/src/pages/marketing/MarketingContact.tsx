import { MarketingProse } from "./MarketingLayout";

export default function MarketingContact() {
  return (
    <MarketingProse
      title="Contact"
      description="Product, security, and Cloud support channels."
    >
      <p>
        Product and security contact for ReBotics / GodMode:{" "}
        <a href="mailto:security@rebotics.ai">security@rebotics.ai</a> (replace with your
        production inbox before Stripe live).
      </p>
      <p>
        Support for Cloud customers is also available inside the product Support surface when
        signed in.
      </p>
      <p>
        Source:{" "}
        <a
          href="https://github.com/ReBoticsAI/GodMode"
          target="_blank"
          rel="noreferrer"
        >
          github.com/ReBoticsAI/GodMode
        </a>
      </p>
    </MarketingProse>
  );
}
