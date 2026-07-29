import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Page, PageHeader } from "@/components/PageHeader";
import {
  FEATURE_SECTION_ORDER,
  featureDocsForIndex,
} from "@/lib/feature-docs";
import { cn } from "@/lib/utils";
import {
  MARKETING_BASE,
  marketingBadgeClass,
  marketingCardClass,
  marketingCardDescriptionClass,
  marketingCardTitleClass,
  marketingPageDescriptionClass,
  marketingSectionTitleClass,
} from "./MarketingLayout";

export default function MarketingFeaturesIndex() {
  const docs = featureDocsForIndex();
  const bySection = FEATURE_SECTION_ORDER.map((section) => ({
    section,
    items: docs.filter((d) => d.section === section),
  })).filter((g) => g.items.length > 0);

  return (
    <Page>
      <PageHeader
        title="Features"
        description="What ships in the Control Center. Marketing tells the story; these pages go deeper for humans and agents. Full operator docs live on GitHub."
        descriptionClassName={marketingPageDescriptionClass}
      />

      {bySection.map(({ section, items }) => (
        <section key={section} className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <h2 className={marketingSectionTitleClass}>{section}</h2>
            <Badge variant="secondary" className={marketingBadgeClass}>
              {items.length}
            </Badge>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((doc) => (
              <Card
                key={doc.slug}
                className={cn(marketingCardClass, "transition-colors hover:bg-muted/40")}
              >
                <Link
                  to={`${MARKETING_BASE}/features/${doc.slug}`}
                  className="block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <CardHeader>
                    <CardTitle className={marketingCardTitleClass}>{doc.title}</CardTitle>
                    <CardDescription className={marketingCardDescriptionClass}>
                      {doc.summary || doc.location}
                    </CardDescription>
                  </CardHeader>
                </Link>
              </Card>
            ))}
          </div>
        </section>
      ))}
    </Page>
  );
}
