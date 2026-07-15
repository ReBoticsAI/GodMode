import type { FieldDef, FieldType, ObjectTypeDef } from "@godmode/kernel";
import type { SqlReadAdapterOptions } from "../adapters/sql-read.js";

export type FieldSpec = string | [string, FieldType];

export interface BuiltinSpec extends SqlReadAdapterOptions {
  name: string;
  label: string;
  module: string;
  fields: FieldSpec[];
  writable?: string[];
  required?: string[];
  operations?: ObjectTypeDef["operations"];
  actions?: ObjectTypeDef["actions"];
  permissions?: ObjectTypeDef["permissions"];
  accessPolicy?: string;
}

export const READ_PERMISSIONS: ObjectTypeDef["permissions"] = [
  { role: "viewer", read: true },
  { role: "editor", read: true },
  { role: "owner", read: true },
  { role: "intelligence", read: true },
];

export const WRITE_PERMISSIONS: ObjectTypeDef["permissions"] = [
  { role: "viewer", read: true },
  { role: "editor", read: true, create: true, update: true, delete: true },
  { role: "owner", read: true, create: true, update: true, delete: true },
  {
    role: "intelligence",
    read: true,
    create: true,
    update: true,
    delete: true,
  },
];

export function buildFields(
  specs: FieldSpec[],
  writable: ReadonlySet<string>,
  required: ReadonlySet<string>
): FieldDef[] {
  return specs.map((spec, index) => {
    const [name, fieldType] =
      typeof spec === "string" ? [spec, "Data" as FieldType] : spec;
    return {
      name,
      label: name
        .split("_")
        .map((part) => part[0]?.toUpperCase() + part.slice(1))
        .join(" "),
      fieldType,
      inList: index < 6,
      inForm: writable.has(name),
      required: required.has(name),
    };
  });
}
