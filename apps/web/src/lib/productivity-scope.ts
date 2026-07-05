export type ProductivityScope =
  | { kind: "agent"; agentId: string }
  | { kind: "user"; userId?: string; readOnly?: boolean };

export function isUserScope(scope: ProductivityScope): scope is {
  kind: "user";
  userId?: string;
  readOnly?: boolean;
} {
  return scope.kind === "user";
}

export function scopeReadOnly(scope: ProductivityScope): boolean {
  return scope.kind === "user" && scope.readOnly === true;
}
