---
name: shadcn-ui
description: Build and extend GodMode web UI with shadcn/ui components in apps/web. Use before editing React pages, forms, tables, or dialogs.
tools: [read_file, edit_file, write_file, grep, glob, use_skill]
---

# shadcn/ui — GodMode web UI

GodMode's web app lives in `apps/web`. UI components are **source-owned** shadcn/ui under `@/components/ui`.

## Project layout

- Config: `apps/web/components.json` (style: `base-nova`, aliases: `@/components/ui`, `@/lib/utils`)
- Components: `apps/web/src/components/ui/*`
- Pages: `apps/web/src/pages/**`
- Utilities: `cn()` from `@/lib/utils`
- Icons: `lucide-react`

Add new components from repo root:

```bash
cd apps/web && npx shadcn@latest add card table badge button
```

## Principles

1. **Use existing shadcn components first** — `Card`, `Table`, `Badge`, `Button`, `Tabs`, `Alert`, `Separator`, `Skeleton`, `Switch`, `Label` before custom markup.
2. **Compose, don't reinvent** — settings = `Tabs` + `Card` + form controls; data pages = `Card` + `Table`.
3. **Use built-in variants** — `variant="outline"`, `size="sm"`, etc. Do not override component colors with raw Tailwind color classes.
4. **Semantic tokens** — `bg-background`, `text-muted-foreground`, `border-border`. No `bg-blue-500` or manual `dark:` color overrides.

## Layout & styling rules

- Use `flex` + `gap-*` for spacing. Avoid `space-x-*` / `space-y-*`.
- Use `size-*` when width and height match (`size-10` not `w-10 h-10`).
- Use `truncate` shorthand for ellipsis.
- Use `cn()` for conditional classes.
- Full Card composition: `CardHeader` / `CardTitle` / `CardDescription` / `CardContent` / `CardFooter`.

## Common patterns in this repo

```tsx
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
```

- Status chips: `Badge` with `variant="default" | "secondary" | "destructive"`.
- Loading: `Skeleton` or muted text — not custom pulse divs.
- Toasts: `toast()` from `sonner` (already used in Intelligence panel).
- Dialogs need `DialogTitle` (use `className="sr-only"` if visually hidden).

## When editing pages

1. `read_file` the target page and nearby pages for conventions.
2. Reuse existing layout primitives (`PageHeader`, cards, tables).
3. Keep diffs focused — one page/feature per task unless explicitly asked for more.
4. After UI edits, mention which route to open to verify (e.g. the page you changed).

## Forms (shadcn Field API)

- Use `FieldGroup` + `Field` + `FieldLabel` for form layout — not raw `div` with `space-y-*`.
- Validation: `data-invalid` on `Field`, `aria-invalid` on the control.
- Icons in buttons: `data-icon="inline-start"` or `data-icon="inline-end"` on the icon; no `size-4` on icons inside components.

## Plugins

Plugin pages use the same shadcn components and tokens as the host. Prefer importing the curated set from `@godmode/web-host` so SaaS `build_plugin` and Marketplace packs share host instances:

```typescript
import { Button, Card, CardContent, Empty, cn } from "@godmode/web-host";
```

Curated exports: `cn`, `Button` / `buttonVariants`, `Card` family, `Empty` family, `Badge` / `badgeVariants`, `Alert` family, `Separator`, `Skeleton`, `Tabs` family, plus host singletons (`StructureTabGroupPage`, `pageElementFor`, `webPluginRuntime`).

- **Intelligence / SaaS:** always use `@godmode/web-host` for UI. Do **not** import `@/components/ui` (aliases are absent). Do not hand-roll Card/Button/Empty shells.
- **Full monorepo:** `@/components/ui/*` may work when aliases exist; still prefer `@godmode/web-host` for plugin bundles so externals stay consistent. Never bundle host singletons via `@/`.
- **No decorative primary CTAs:** every `Button` the user would treat as an action needs `onClick`, a `Link`/`navigate` target, or form submit. Labels like Got it / Get started / Archive without a handler are incomplete plugin UI.
- Prefer host `record-list` / `record-form` Structure kinds for CRUD; custom Welcome pages should deep-link into those lists rather than dead Buttons.

## Scope

GodMode web UI is shared across all workspaces. Prefer edits under `apps/web/src/pages/**` and `@/components/ui` when changing host chrome. For plugin pages, follow the Plugins section above.
