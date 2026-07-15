import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Page, PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
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
        const list = await fetchRecords(objectType);
        return [ot, list] as const;
      })
      .then(([ot, list]) => {
        if (cancelled) return;
        setDef(ot);
        setRows(list.records);
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
  }, [objectType]);

  const listFields = (def?.fields ?? []).filter(
    (f) => f.inList !== false && f.fieldType !== "JSON"
  );

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
      {!loading && !error && def && (
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
      )}
    </Page>
  );
}

export default RecordListPage;
