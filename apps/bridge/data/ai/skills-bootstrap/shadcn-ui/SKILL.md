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

## Scope

GodMode web UI is shared across all workspaces. Prefer edits under `apps/web/src/pages/**` and `@/components/ui`.
