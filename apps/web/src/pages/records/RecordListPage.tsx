import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Page, PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  fetchObjectType,
  fetchRecords,
  runRecordActionApi,
  waitForOperationRun,
  type ObjectTypeClient,
  type RecordRowClient,
} from "@/lib/object-types-api";
import { useStructure } from "@/lib/structure-context";
import type { DepartmentNode, PageNode } from "@/lib/navigation";

function findPageContext(
  pathname: string,
  departments: DepartmentNode[]
): PageNode | undefined {
  for (const d of departments) {
    for (const div of d.divisions) {
      for (const p of div.pages) {
        const full =
          p.segment === ""
            ? div.basePath
            : `${div.basePath.replace(/\/$/, "")}/${p.segment}`;
        if (pathname === full) return p;
      }
    }
  }
  return undefined;
}

export function RecordListPage({
  objectType: objectTypeProp,
}: {
  objectType?: string;
}) {
  const params = useParams();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { departments } = useStructure();
  const objectType = useMemo(() => {
    if (objectTypeProp) return objectTypeProp;
    if (params.objectType) return params.objectType;
    const page = findPageContext(pathname, departments);
    if (page?.kind === "record-list") return page.objectType || undefined;
    return undefined;
  }, [objectTypeProp, params.objectType, pathname, departments]);

  const [def, setDef] = useState<ObjectTypeClient | null>(null);
  const [rows, setRows] = useState<RecordRowClient[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [draftFilters, setDraftFilters] = useState<Record<string, string>>({});
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const limit = 50;

  useEffect(() => {
    if (!objectType) {
      setLoading(false);
      setError(
        "No ObjectType specified (set page ObjectType metadata or /records/:objectType)"
      );
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchObjectType(objectType)
      .then(async (ot) => {
        if (ot.operations && !ot.operations.includes("list")) {
          throw new Error(`Listing ${ot.labelPlural ?? ot.label} is disabled`);
        }
        const list = await fetchRecords(objectType, {
          limit,
          offset,
          filters,
        });
        return [ot, list] as const;
      })
      .then(([ot, list]) => {
        if (cancelled) return;
        setDef(ot);
        setRows(list.records);
        setTotal(list.total);
        setError(null);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [objectType, offset, filters]);

  const listFields = (def?.fields ?? []).filter(
    (f) => f.inList !== false && f.fieldType !== "JSON"
  );
  const collectionActions = (def?.actions ?? []).filter(
    (action) => action.target === "collection"
  );

  async function runCollectionAction(
    action: NonNullable<ObjectTypeClient["actions"]>[number]
  ) {
    const properties =
      action.inputSchema?.properties &&
      typeof action.inputSchema.properties === "object"
        ? Object.keys(action.inputSchema.properties)
        : [];
    if (properties.length) {
      setError(
        `${action.label} requires input; use its dedicated domain UI until the schema form is available here.`
      );
      return;
    }
    const confirmed =
      action.confirm === true || action.confirmation?.required === true;
    if (confirmed && !window.confirm(`Run ${action.label}?`)) return;
    setError(null);
    setActionStatus(`${action.label} running…`);
    try {
      const result = await runRecordActionApi(objectType!, action.name, {}, {
        confirmed,
        idempotencyKey:
          action.effect && action.effect !== "read"
            ? crypto.randomUUID()
            : undefined,
      });
      if (
        result &&
        typeof result === "object" &&
        "operationRunId" in result
      ) {
        const run = await waitForOperationRun(
          String((result as { operationRunId: unknown }).operationRunId)
        );
        if (run.status !== "succeeded") {
          throw new Error(run.errorMessage ?? `${action.label} ${run.status}`);
        }
      }
      setActionStatus(`${action.label} completed`);
      const list = await fetchRecords(objectType!, { limit, offset, filters });
      setRows(list.records);
      setTotal(list.total);
    } catch (err) {
      setActionStatus(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Page>
      <PageHeader
        title={def?.labelPlural ?? def?.label ?? objectType ?? "Records"}
        description={def?.description ?? "ObjectType Record list"}
        actions={
          objectType &&
          def &&
          (!def.operations || def.operations.includes("create")) ? (
            <Button
              onClick={() =>
                navigate(`/records/${encodeURIComponent(objectType)}/new`)
              }
            >
              New
            </Button>
          ) : null
        }
      />
      {loading && <p className="text-muted-foreground text-sm">Loading…</p>}
      {error && <p className="text-destructive text-sm">{error}</p>}
      <p aria-live="polite" className="text-muted-foreground text-sm">
        {actionStatus}
      </p>
      {!loading && !error && def && (
        <>
        {listFields.length > 0 && (
          <form
            className="mb-4 flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setOffset(0);
              setFilters(draftFilters);
            }}
          >
            {listFields.slice(0, 3).map((field) => (
              <label key={field.name} className="grid gap-1 text-sm">
                <span>{field.label}</span>
                <Input
                  name={field.name}
                  value={draftFilters[field.name] ?? ""}
                  onChange={(event) =>
                    setDraftFilters((current) => ({
                      ...current,
                      [field.name]: event.target.value,
                    }))
                  }
                />
              </label>
            ))}
            <Button type="submit" variant="outline">Apply filters</Button>
          </form>
        )}
        {collectionActions.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-2" aria-label="Collection actions">
            {collectionActions.map((action) => (
              <Button
                key={action.name}
                variant={action.effect === "destructive" ? "destructive" : "outline"}
                onClick={() => void runCollectionAction(action)}
              >
                {action.label}
              </Button>
            ))}
          </div>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              {listFields.map((f) => (
                <TableHead key={f.name}>{f.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={Math.max(listFields.length, 1)}
                  className="text-muted-foreground"
                >
                  No records yet.
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.id}>
                {listFields.map((f, idx) => (
                  <TableCell key={f.name}>
                    {idx === 0 &&
                    (!def.operations || def.operations.includes("get")) ? (
                      <Link
                        className="underline-offset-2 hover:underline"
                        to={`/records/${encodeURIComponent(objectType!)}/${encodeURIComponent(r.id)}`}
                      >
                        {String(r.data[f.name] ?? "")}
                      </Link>
                    ) : (
                      String(r.data[f.name] ?? "")
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="mt-4 flex items-center justify-between gap-4">
          <p className="text-muted-foreground text-sm">
            {total === 0
              ? "0 records"
              : `${offset + 1}–${Math.min(offset + limit, total)} of ${total}`}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={offset === 0}
              onClick={() => setOffset((value) => Math.max(0, value - limit))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              disabled={offset + limit >= total}
              onClick={() => setOffset((value) => value + limit)}
            >
              Next
            </Button>
          </div>
        </div>
        </>
      )}
    </Page>
  );
}

export default RecordListPage;
