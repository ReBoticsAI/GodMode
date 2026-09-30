import type { GraphTourStop } from "@/lib/guide-ui-action";
import type { IntelligenceInterestId } from "@/lib/intelligence-interests";

/**
 * Scripted Graph walk for the first Intelligence choice.
 * The sentences and stops are fixed. This turn does not call a model.
 */
const INTEREST_TOURS: Record<IntelligenceInterestId, GraphTourStop[]> = {
  create: [
    {
      nodeId: "hub:you",
      label: "You",
      say: "You are the center of the Graph. What you want to make starts from your identity, memories, and preferences.",
    },
    {
      nodeId: "hub:heart",
      label: "Hub",
      say: "Hub is home base, where you open projects and see everything you are creating.",
    },
    {
      nodeId: "hub:intelligence",
      label: "Intelligence",
      say: "Intelligence is your collaborator on the Graph. It helps you shape pages, agents, and structure with you.",
    },
    {
      nodeId: "hub:workspace",
      label: "Workspaces",
      say: "Workspaces hold what you make: pages, plugins, agents, and the rest of the structure.",
    },
    {
      nodeId: "hub:wiki",
      label: "Wiki",
      say: "Wiki keeps the knowledge, skills, rules, and artifacts that belong with that work.",
    },
    {
      nodeId: "hub:vault-you",
      label: "Personal Vault",
      say: "Personal Vault keeps the keys and files that stay with you.",
    },
  ],
  earn: [
    {
      nodeId: "hub:you",
      label: "You",
      say: "You are the center of the Graph. What you make here is what you can sell.",
    },
    {
      nodeId: "hub:heart",
      label: "Hub",
      say: "Hub is home base for the projects you might offer.",
    },
    {
      nodeId: "hub:intelligence",
      label: "Intelligence",
      say: "Intelligence helps you shape what you make before anyone can buy it.",
    },
    {
      nodeId: "hub:workspace",
      label: "Workspaces",
      say: "Workspaces hold the pages, plugins, and agents you can list.",
    },
    {
      nodeId: "hub:marketplace",
      label: "Marketplace",
      say: "Marketplace is where a local install sells. A GodMode Seller account is commerce only, your files stay on this machine, and it is not a Cloud workspace.",
    },
  ],
  organize: [
    {
      nodeId: "hub:you",
      label: "You",
      say: "You are the center of the Graph. Organizing starts with what belongs to you.",
    },
    {
      nodeId: "hub:heart",
      label: "Hub",
      say: "Hub is where you see the whole structure at a glance.",
    },
    {
      nodeId: "hub:workspace",
      label: "Workspaces",
      say: "Workspaces group the pages, agents, and projects you are managing.",
    },
    {
      nodeId: "hub:wiki",
      label: "Wiki",
      say: "Wiki holds the knowledge so you can find it again.",
    },
    {
      nodeId: "hub:intelligence",
      label: "Intelligence",
      say: "Intelligence helps you sort what you already have. It does not start a new build in this chat.",
    },
  ],
  automate: [
    {
      nodeId: "hub:you",
      label: "You",
      say: "You decide what should keep moving without you watching it.",
    },
    {
      nodeId: "hub:heart",
      label: "Hub",
      say: "Hub shows the work that can run on its own.",
    },
    {
      nodeId: "hub:intelligence",
      label: "Intelligence",
      say: "Intelligence can design the agents and schedules that keep that work moving.",
    },
    {
      nodeId: "hub:workspace",
      label: "Workspaces",
      say: "Workspaces hold the workflows, hooks, and agents that run it.",
    },
    {
      nodeId: "hub:wiki",
      label: "Wiki",
      say: "Wiki stores the rules and skills those automations follow.",
    },
  ],
  explore: [
    {
      nodeId: "hub:you",
      label: "You",
      say: "You are the structure that moves through space.",
    },
    {
      nodeId: "hub:heart",
      label: "Hub",
      say: "Hub is the home you leave from and come back to.",
    },
    {
      nodeId: "hub:workspace",
      label: "Workspaces",
      say: "Workspaces are the structure you maneuver on the Graph.",
    },
    {
      nodeId: "hub:intelligence",
      label: "Intelligence",
      say: "Intelligence stays with you and explains what you are looking at.",
    },
  ],
  battle: [
    {
      nodeId: "hub:you",
      label: "You",
      say: "Out in the open, another structure can reach you.",
    },
    {
      nodeId: "hub:heart",
      label: "Hub",
      say: "Hub is the home a hostile would be trying to get into.",
    },
    {
      nodeId: "hub:workspace",
      label: "Workspaces",
      say: "Workspaces are the structure you defend when you meet something hostile in space.",
    },
    {
      nodeId: "hub:intelligence",
      label: "Intelligence",
      say: "Intelligence explains that encounter. There is no live battle screen in this chat.",
    },
  ],
  social: [
    {
      nodeId: "hub:you",
      label: "You",
      say: "Connecting your structure puts you in range of others.",
    },
    {
      nodeId: "hub:heart",
      label: "Hub",
      say: "Hub is the home a friendly structure can meet.",
    },
    {
      nodeId: "hub:workspace",
      label: "Workspaces",
      say: "Workspaces are what you can share when you encounter someone friendly in space.",
    },
    {
      nodeId: "hub:intelligence",
      label: "Intelligence",
      say: "Intelligence helps you talk with that friendly structure.",
    },
  ],
  learn: [
    {
      nodeId: "hub:you",
      label: "You",
      say: "You gain knowledge by connecting your structure to others.",
    },
    {
      nodeId: "hub:heart",
      label: "Hub",
      say: "Hub is where new knowledge shows up beside what you already have.",
    },
    {
      nodeId: "hub:wiki",
      label: "Wiki",
      say: "Wiki is where that knowledge is kept so you can use it.",
    },
    {
      nodeId: "hub:workspace",
      label: "Workspaces",
      say: "Workspaces are the structures you connect to when you want to learn.",
    },
    {
      nodeId: "hub:intelligence",
      label: "Intelligence",
      say: "Intelligence helps you read what those connections open up.",
    },
  ],
};

export function interestTour(id: string): GraphTourStop[] | null {
  const stops = INTEREST_TOURS[id as IntelligenceInterestId];
  return stops ? stops.map((stop) => ({ ...stop })) : null;
}
