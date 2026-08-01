#!/usr/bin/env node
/** SQLite integrity_check for a DB mounted at /db.sqlite (readonly). */
import Database from "better-sqlite3";

const db = new Database("/db.sqlite", { readonly: true, fileMustExist: true });
try {
  const result = db.pragma("integrity_check", { simple: true });
  if (result !== "ok") {
    console.error(result);
    process.exit(1);
  }
  console.log("ok");
} finally {
  db.close();
}
