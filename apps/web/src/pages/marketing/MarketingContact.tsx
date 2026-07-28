import { MarketingProse } from "./MarketingLayout";

export default function MarketingContact() {
  return (
    <MarketingProse
      title="Contact"
      description="Product, security, and Cloud support channels."
    >
      <p>
        Product, Cloud, and billing:{" "}
        <a href="mailto:support@godmode.software">support@godmode.software</a>.
      </p>
      <p>
        Security reports:{" "}
        <a href="mailto:security@rebotics.ai">security@rebotics.ai</a>.
      </p>
      <p>
        Signed-in Cloud customers can also use the in-product Support surface.
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
