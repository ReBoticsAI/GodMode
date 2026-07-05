import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { BotIcon, StoreIcon, Share2Icon } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStartTour: () => void;
};

export function NewUserOnboardingDialog({ open, onOpenChange, onStartTour }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Welcome to GodMode</DialogTitle>
          <DialogDescription>
            You start with Intelligence (GodMode's AI), Calendar, Tasks, Wiki, and Vault — an empty
            workspace ready to build or extend from the Marketplace.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-3 text-sm text-muted-foreground">
          <li className="flex gap-2">
            <BotIcon className="size-4 shrink-0 mt-0.5" />
            <span>
              <strong className="text-foreground">Intelligence</strong> helps you create agents,
              departments, and automations.
            </span>
          </li>
          <li className="flex gap-2">
            <Share2Icon className="size-4 shrink-0 mt-0.5" />
            <span>
              <strong className="text-foreground">Shared</strong> lets teammates access live
              resources you grant them.
            </span>
          </li>
          <li className="flex gap-2">
            <StoreIcon className="size-4 shrink-0 mt-0.5" />
            <span>
              <strong className="text-foreground">Marketplace</strong> installs starter packs
              and plugins into your workspace.
            </span>
          </li>
        </ul>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            onClick={() => {
              onOpenChange(false);
              onStartTour();
            }}
          >
            Tour with Intelligence
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Explore on my own
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
