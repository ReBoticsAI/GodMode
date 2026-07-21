# Core vs plugins

How we decide what belongs in GodMode core versus a plugin. Roadmap: [GodMode Roadmap](https://github.com/users/ReBoticsAI/projects/1).

## Test for Core

Ship in **core** only if **all** of these are true:

1. Most users would be blocked or embarrassed if they had to build or buy this just to live in GodMode day to day.
2. It is cross-cutting (many domains depend on it).
3. It is control or system-of-record, not a single external product or profession.

## Plugin

Ship as a **plugin** when the work is profession, hobby, vendor, or niche workflow. Intelligence can scaffold and build it; Marketplace is how others install it without rebuilding (often for a fee).

Examples: trading and markets, vendor-specific robot or smart-home packs, external SaaS sync connectors (Gmail, Notion, and similar).

## On the fence

Track as **on-the-fence** when the capability might become Core later if most users need it, but is not Core today (for example full eCommerce, full ERP depth, heavy CRM beyond Contacts).

## Owned vs connected

| Core | Not Core (plugin / fence) |
|------|---------------------------|
| Owned email (send/receive in GodMode) and domains | Syncing an external Gmail or Outlook account |
| Accounting (income, expenses, accounts, reports) | Exchange OAuth for funded trading agents |
| Contacts as relationship system-of-record | Industry CRM suites as deep verticals |
| Robot / IoT **actor plane** (registry, telemetry, commands, audit) | Brand-specific device SDKs |
| Wiki with stronger editing and export | A separate docs product outside wiki |

## Labels

- `core`: Control Center completeness work
- `on-the-fence`: may graduate to Core later
- `plugin-backlog`: useful, not for most users; prefer Marketplace
