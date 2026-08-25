import { Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { MarketingLayout } from "./MarketingLayout";
import MarketingHome from "./MarketingHome";
import MarketingPricing from "./MarketingPricing";
import MarketingDownloads from "./MarketingDownloads";
import MarketingTerms from "./MarketingTerms";
import MarketingRefund from "./MarketingRefund";
import MarketingPrivacy from "./MarketingPrivacy";
import MarketingSecurity from "./MarketingSecurity";
import MarketingContact from "./MarketingContact";
import MarketingFeaturesIndex from "./MarketingFeaturesIndex";
import MarketingFeaturePage from "./MarketingFeaturePage";
import MarketingMarketplace from "./MarketingMarketplace";
import MarketingSellerStorefront from "./MarketingSellerStorefront";

/** Public marketing site (Stripe business website). shadcn, not behind AuthGate. */
export default function MarketingRoutes() {
  return (
    <>
      <Routes>
        <Route element={<MarketingLayout />}>
          <Route index element={<MarketingHome />} />
          <Route path="features" element={<MarketingFeaturesIndex />} />
          <Route path="features/:slug" element={<MarketingFeaturePage />} />
          <Route path="marketplace" element={<MarketingMarketplace />} />
          <Route path="marketplace/:handle" element={<MarketingSellerStorefront />} />
          <Route path="pricing" element={<MarketingPricing />} />
          <Route path="downloads" element={<MarketingDownloads />} />
          <Route path="terms" element={<MarketingTerms />} />
          <Route path="refund" element={<MarketingRefund />} />
          <Route path="privacy" element={<MarketingPrivacy />} />
          <Route path="security" element={<MarketingSecurity />} />
          <Route path="contact" element={<MarketingContact />} />
        </Route>
      </Routes>
      <Toaster richColors position="top-right" />
    </>
  );
}
