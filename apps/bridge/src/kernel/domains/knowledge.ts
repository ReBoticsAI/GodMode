import type { BuiltinSpec } from "./shared.js";
import { CONTENT_LIFECYCLE_ACTIONS } from "../adapters/content.js";

export const KNOWLEDGE_SPECS: BuiltinSpec[] = [
  { name: "WikiPage", label: "Wiki Page", module: "knowledge", id: "wiki_page_service", table: "wiki_pages", database: "core", scope: "tenant", defaultSort: "updated_at", writable: ["space", "slug", "title", "body_markdown", "visibility"], required: ["title"], fields: ["id", "tenant_id", "space", "slug", "title", "body_markdown", "visibility", "author_user_id", "created_at", "updated_at"] },
  { name: "WikiRevision", label: "Wiki Revision", module: "knowledge", id: "wiki_revision_service", table: "wiki_revisions", database: "core", defaultSort: "created_at", fields: ["id", "page_id", "title", "body_markdown", "author_user_id", "created_at"] },
  { name: "WikiProposal", label: "Wiki Proposal", module: "knowledge", id: "wiki_proposal_service", table: "wiki_page_proposals", database: "core", scope: "tenant", defaultSort: "updated_at", writable: ["action", "space", "slug", "title", "body_markdown", "target_page_id", "reason", "source"], required: ["title"], operations: ["list", "get", "create"], actions: CONTENT_LIFECYCLE_ACTIONS, fields: ["id", "tenant_id", "action", "space", "slug", "title", "body_markdown", "target_page_id", "status", "reason", "source", "created_at", "updated_at"] },
  { name: "KnowledgePack", label: "Knowledge Pack", module: "knowledge", id: "knowledge_pack_read", table: "ai_knowledge_packs", defaultSort: "updated_at", fields: ["id", "name", "description", "created_at", "updated_at"] },
];
