import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  guideChoiceProfilesForOptions,
  type GuideNextOption,
} from "@/lib/guide-next-choice";

export function GuideChoiceChart({
  question,
  why,
  options,
  disabled,
  onChoose,
}: {
  question: string;
  why?: string;
  options: GuideNextOption[];
  disabled?: boolean;
  onChoose: (option: GuideNextOption) => void;
}) {
  const profiles = guideChoiceProfilesForOptions(options);
  const profiled = new Set(profiles.map((profile) => profile.optionId));
  const extras = options.filter((option) => !profiled.has(option.id));

  return (
    <div className="flex flex-col gap-3 py-2">
      <p className="text-base font-medium text-foreground">{question}</p>
      {profiles.map((profile) => (
        <Card key={profile.optionId} size="sm">
          <CardHeader>
            <CardTitle>{profile.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2">
              {profile.rows.map((row, index) => (
                <div key={row.label} className="flex flex-col gap-2">
                  {index > 0 ? <Separator /> : null}
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="shrink-0 text-muted-foreground">{row.label}</span>
                    <span className="min-w-0 text-right">{row.value}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
          <CardFooter className="items-center justify-between gap-3">
            <p className="min-w-0 flex-1 text-muted-foreground">{profile.sell}</p>
            <Button
              type="button"
              variant="outline"
              className="shrink-0"
              disabled={disabled}
              onClick={() => onChoose({ id: profile.optionId, label: profile.label })}
            >
              {profile.label}
            </Button>
          </CardFooter>
        </Card>
      ))}
      {extras.length > 0 ? (
        <Card size="sm">
          {why ? (
            <CardContent>
              <p className="text-muted-foreground">{why}</p>
            </CardContent>
          ) : null}
          <CardFooter className="flex-wrap gap-2">
            {extras.map((option) => (
              <Button
                key={option.id}
                type="button"
                variant="outline"
                disabled={disabled}
                onClick={() => onChoose(option)}
              >
                {option.label}
              </Button>
            ))}
          </CardFooter>
        </Card>
      ) : null}
    </div>
  );
}
