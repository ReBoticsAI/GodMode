import { useEffect, useState, type ReactNode } from "react";
import type { GodModeWebPluginApi, GodModeWebPluginRegister } from "@godmode/plugin-api";
import { useNavigate } from "react-router-dom";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  cn,
} from "@godmode/web-host";

const RECORD_TYPE = "__RECORD_TYPE__";

type DomainRow = {
  id: string;
  data?: { title?: unknown; body?: unknown };
};

function WelcomePage({ api }: { api: GodModeWebPluginApi }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<DomainRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await api.kernel.listRecords(RECORD_TYPE, { limit: 20 });
        if (cancelled) return;
        setRows((result.records ?? []) as DomainRow[]);
        setTotal(Number(result.total ?? result.records?.length ?? 0));
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  let body: ReactNode;
  if (loading) {
    body = <p className="text-sm text-muted-foreground">Loading rows from plugin SQLite…</p>;
  } else if (error) {
    body = <p className="text-sm text-destructive">{error}</p>;
  } else if (total === 0) {
    body = (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No rows yet</EmptyTitle>
          <EmptyDescription>
            Domain data lives in plugin SQLite via openPluginDb. Create a row with generated
            ObjectType tools, then refresh this page.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  } else {
    body = (
      <ul className="flex flex-col gap-2">
        {rows.map((row) => {
          const title =
            typeof row.data?.title === "string" && row.data.title.trim()
              ? row.data.title
              : row.id;
          const bodyText =
            typeof row.data?.body === "string" && row.data.body.trim()
              ? row.data.body
              : null;
          return (
            <li
              key={row.id}
              className="rounded-md border border-border px-3 py-2 text-sm"
            >
              <div className="font-medium">{title}</div>
              {bodyText ? (
                <div className="text-muted-foreground line-clamp-2">{bodyText}</div>
              ) : null}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className={cn("mx-auto flex max-w-lg flex-col gap-6 p-6")}>
      <Card>
        <CardHeader>
          <CardTitle>__PLUGIN_NAME__</CardTitle>
          <CardDescription>
            Live rows from plugin SQLite (ObjectType {RECORD_TYPE} via openPluginDb), not
            workspace Records.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {body}
          <Button type="button" onClick={() => navigate("/__PLUGIN_ID__")}>
            Open __PLUGIN_NAME__
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export const registerWeb: GodModeWebPluginRegister = (api) => {
  api.pageKinds.register([
    { kind: "__PLUGIN_ID__-welcome", component: () => <WelcomePage api={api} /> },
  ]);
};
