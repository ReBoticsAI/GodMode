import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Page, PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createRecordApi,
  deleteRecordApi,
  fetchObjectType,
  fetchRecord,
  runRecordActionApi,
  updateRecordApi,
  type FieldDefClient,
  type ObjectTypeClient,
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

function formFields(def: ObjectTypeClient): FieldDefClient[] {
  return def.fields.filter(
    (f) => f.fieldType !== "ReadOnly" && f.inForm !== false
  );
}

export function RecordFormPage({
  objectType: objectTypeProp,
  recordId: recordIdProp,
}: {
  objectType?: string;
  recordId?: string;
}) {
  const params = useParams();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { departments } = useStructure();

  const objectType = useMemo(() => {
    if (objectTypeProp) return objectTypeProp;
    if (params.objectType) return params.objectType;
    const page = findPageContext(pathname, departments);
    if (page?.kind === "record-form" || page?.kind === "record-list") {
      return page.objectType || undefined;
    }
    return undefined;
  }, [objectTypeProp, params.objectType, pathname, departments]);

  const recordId = recordIdProp ?? params.recordId;
  const isNew = !recordId || recordId === "new";

  const [def, setDef] = useState<ObjectTypeClient | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [actionValues, setActionValues] = useState<
    Record<string, Record<string, string>>
  >({});
  const [status, setStatus] = useState<string | null>(null);
  const canSave =
    !!def &&
    (!def.operations ||
      def.operations.includes(isNew ? "create" : "update"));

  useEffect(() => {
    if (!objectType) return;
    let cancelled = false;
    (async () => {
      try {
        const ot = await fetchObjectType(objectType);
        if (cancelled) return;
        setDef(ot);
        const initial: Record<string, string> = {};
        for (const f of formFields(ot)) {
          initial[f.name] = "";
        }
        if (!isNew && recordId) {
          if (ot.operations && !ot.operations.includes("get")) {
            throw new Error(`Reading ${ot.label} records is disabled`);
          }
          const row = await fetchRecord(objectType, recordId);
          if (cancelled) return;
          for (const f of formFields(ot)) {
            const v = row.data[f.name];
            initial[f.name] =
              v == null ? "" : typeof v === "string" ? v : JSON.stringify(v);
          }
        }
        setValues(initial);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [objectType, recordId, isNew]);

  async function onSave() {
    if (!objectType || !def) return;
    setSaving(true);
    setError(null);
    try {
      const data: Record<string, unknown> = {};
      for (const f of formFields(def)) {
        const raw = values[f.name] ?? "";
        if (raw === "" && !f.required) {
          if (!isNew) data[f.name] = null;
          continue;
        }
        if (f.fieldType === "Int") data[f.name] = Number.parseInt(raw, 10);
        else if (f.fieldType === "Float") data[f.name] = Number.parseFloat(raw);
        else if (f.fieldType === "Check")
          data[f.name] = raw === "true" || raw === "1";
        else if (f.fieldType === "JSON") {
          try {
            data[f.name] = JSON.parse(raw);
          } catch {
            data[f.name] = raw;
          }
        } else data[f.name] = raw;
      }
      if (isNew) {
        const created = await createRecordApi(objectType, data);
        navigate(
          `/records/${encodeURIComponent(objectType)}/${encodeURIComponent(created.id)}`
        );
      } else if (recordId) {
        await updateRecordApi(objectType, recordId, data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function refreshRecord() {
    if (!objectType || !recordId || !def || isNew) return;
    const row = await fetchRecord(objectType, recordId);
    const next: Record<string, string> = {};
    for (const field of formFields(def)) {
      const value = row.data[field.name];
      next[field.name] =
        value == null
          ? ""
          : typeof value === "string"
            ? value
            : JSON.stringify(value);
    }
    setValues(next);
  }

  async function onDelete() {
    if (!objectType || !recordId || !def) return;
    if (!window.confirm(`Delete this ${def.label}? This cannot be undone.`)) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await deleteRecordApi(objectType, recordId);
      navigate(`/records/${encodeURIComponent(objectType)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function onAction(action: NonNullable<ObjectTypeClient["actions"]>[number]) {
    if (!objectType || (!recordId && action.target !== "collection")) return;
    const needsConfirmation =
      action.confirm === true || action.confirmation?.required === true;
    if (
      needsConfirmation &&
      !window.confirm(
        `${action.label} may change data or external systems. Continue?`
      )
    ) {
      return;
    }
    const schemaProperties =
      action.inputSchema?.properties &&
      typeof action.inputSchema.properties === "object"
        ? (action.inputSchema.properties as Record<
            string,
            Record<string, unknown>
          >)
        : {};
    const rawValues = actionValues[action.name] ?? {};
    const input: Record<string, unknown> = {};
    for (const [name, schema] of Object.entries(schemaProperties)) {
      const raw = rawValues[name] ?? "";
      if (raw === "") continue;
      if (schema.type === "integer") input[name] = Number.parseInt(raw, 10);
      else if (schema.type === "number") input[name] = Number.parseFloat(raw);
      else if (schema.type === "boolean") input[name] = raw === "true";
      else if (schema.type === "object" || schema.type === "array") {
        input[name] = JSON.parse(raw);
      } else input[name] = raw;
    }
    setRunningAction(action.name);
    setError(null);
    setStatus(null);
    try {
      const result = await runRecordActionApi(objectType, action.name, input, {
        id: action.target === "collection" ? undefined : recordId,
        confirmed: needsConfirmation,
        idempotencyKey:
          action.effect && action.effect !== "read"
            ? crypto.randomUUID()
            : undefined,
      });
      setStatus(
        result &&
          typeof result === "object" &&
          "operationRunId" in result
          ? `${action.label} accepted`
          : `${action.label} completed`
      );
      if (!isNew) await refreshRecord();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunningAction(null);
    }
  }

  return (
    <Page>
      <PageHeader
        title={
          isNew
            ? `New ${def?.label ?? objectType ?? "Record"}`
            : `${def?.label ?? "Record"} ${recordId ?? ""}`
        }
        description="ObjectType form"
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() =>
                objectType &&
                navigate(`/records/${encodeURIComponent(objectType)}`)
              }
            >
              Back
            </Button>
            <Button disabled={saving || !canSave} onClick={() => void onSave()}>
              {saving ? "Saving…" : "Save"}
            </Button>
            {!isNew && def?.operations?.includes("delete") && (
              <Button
                variant="destructive"
                disabled={saving}
                onClick={() => void onDelete()}
              >
                Delete
              </Button>
            )}
          </div>
        }
      />
      {error && (
        <p role="alert" className="text-destructive text-sm mb-4">
          {error}
        </p>
      )}
      <p aria-live="polite" className="text-muted-foreground text-sm mb-4">
        {status}
      </p>
      {def && (
        <div className="grid max-w-xl gap-4">
          {formFields(def).map((f) => (
            <div key={f.name} className="grid gap-1.5">
              <Label htmlFor={f.name}>
                {f.label}
                {f.required ? " *" : ""}
              </Label>
              {f.fieldType === "Select" && f.options?.length ? (
                <select
                  id={f.name}
                  className="border-input bg-background h-9 rounded-md border px-3 text-sm"
                  value={values[f.name] ?? ""}
                  disabled={!canSave}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [f.name]: e.target.value }))
                  }
                >
                  <option value="">—</option>
                  {f.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  id={f.name}
                  value={values[f.name] ?? ""}
                  disabled={!canSave}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [f.name]: e.target.value }))
                  }
                />
              )}
              {f.description && (
                <p className="text-muted-foreground text-xs">{f.description}</p>
              )}
            </div>
          ))}
        </div>
      )}
      {!isNew && def?.actions?.length ? (
        <section className="mt-8 grid max-w-xl gap-4" aria-labelledby="record-actions">
          <h2 id="record-actions" className="text-lg font-semibold">
            Actions
          </h2>
          {def.actions.map((action) => {
            const properties =
              action.inputSchema?.properties &&
              typeof action.inputSchema.properties === "object"
                ? (action.inputSchema.properties as Record<
                    string,
                    Record<string, unknown>
                  >)
                : {};
            return (
              <div key={action.name} className="grid gap-3 rounded-md border p-4">
                <div>
                  <h3 className="font-medium">{action.label}</h3>
                  {action.description ? (
                    <p className="text-muted-foreground text-sm">
                      {action.description}
                    </p>
                  ) : null}
                </div>
                {Object.entries(properties).map(([name, schema]) => (
                  <div key={name} className="grid gap-1.5">
                    <Label htmlFor={`action-${action.name}-${name}`}>
                      {typeof schema.title === "string" ? schema.title : name}
                    </Label>
                    <Input
                      id={`action-${action.name}-${name}`}
                      value={actionValues[action.name]?.[name] ?? ""}
                      onChange={(event) =>
                        setActionValues((current) => ({
                          ...current,
                          [action.name]: {
                            ...current[action.name],
                            [name]: event.target.value,
                          },
                        }))
                      }
                    />
                  </div>
                ))}
                <Button
                  variant={
                    action.effect === "destructive" ? "destructive" : "default"
                  }
                  disabled={runningAction != null}
                  onClick={() => void onAction(action)}
                >
                  {runningAction === action.name
                    ? "Running…"
                    : action.label}
                </Button>
              </div>
            );
          })}
        </section>
      ) : null}
    </Page>
  );
}

export default RecordFormPage;
