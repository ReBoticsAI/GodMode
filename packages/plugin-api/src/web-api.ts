import type { ComponentType, ReactNode } from "react";
import type {
  ListRecordsResult,
  ObjectTypeDef,
  RecordData,
  RecordRow,
} from "@godmode/kernel";
import type { KernelClientApiVersion } from "./kernel-client.js";

export interface PluginRouteDef {
  path: string;
  element: ReactNode;
}

export interface PluginPageKindDef {
  kind: string;
  component: ComponentType;
}

export type PluginShellSlot = "right" | "header" | "footer";

export interface PluginShellChrome {
  id: string;
  /** When structure division has this rightSidebar value */
  rightSidebar?: string;
  slot?: PluginShellSlot;
  component: ComponentType;
}

export interface PluginRootProviderDef {
  id: string;
  component: ComponentType<{ children: ReactNode }>;
}

export interface PluginRedirectDef {
  from: string;
  to: string;
}

export interface WebKernelActionOptions {
  id?: string;
  confirmationId?: string;
  idempotencyKey?: string;
  expectedVersion?: string;
}

export interface WebKernelClient {
  readonly apiVersion: KernelClientApiVersion;
  listObjectTypes(): Promise<ObjectTypeDef[]>;
  listRecords(
    objectType: string,
    query?: {
      limit?: number;
      offset?: number;
      filters?: Record<string, unknown>;
      sort?: string;
      direction?: "asc" | "desc";
    }
  ): Promise<ListRecordsResult>;
  getRecord(objectType: string, id: string): Promise<RecordRow>;
  createRecord(objectType: string, data: RecordData): Promise<RecordRow>;
  updateRecord(
    objectType: string,
    id: string,
    data: RecordData,
    expectedVersion?: string
  ): Promise<RecordRow>;
  deleteRecord(
    objectType: string,
    id: string,
    expectedVersion?: string
  ): Promise<void>;
  runAction(
    objectType: string,
    action: string,
    input: RecordData,
    options?: WebKernelActionOptions
  ): Promise<unknown>;
}

export interface GodModeWebPluginApi {
  readonly manifest: { id: string; version: string; name: string };
  readonly kernel: WebKernelClient;

  routes: {
    register(routes: PluginRouteDef[]): void;
    redirect(from: string, to: string): void;
  };

  pageKinds: {
    register(kinds: PluginPageKindDef[]): void;
  };

  shell: {
    contribute(chrome: PluginShellChrome[]): void;
  };

  rootProviders: {
    register(providers: PluginRootProviderDef[]): void;
  };
}

export type GodModeWebPluginRegister = (api: GodModeWebPluginApi) => void;

export interface PluginWebManifest {
  id: string;
  version: string;
  name: string;
  webEntry?: string;
}
