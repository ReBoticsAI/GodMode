/**
 * Snowflake Cortex base URL normalization (#355).
 * Run: npx tsx apps/bridge/src/services/__tests__/snowflake-cortex-platform.test.ts
 */
import assert from "node:assert/strict";
import { normalizeSnowflakeCortexBaseUrl } from "../snowflake-cortex-platform.js";

assert.equal(
  normalizeSnowflakeCortexBaseUrl("https://org-account.snowflakecomputing.com"),
  "https://org-account.snowflakecomputing.com/api/v2/cortex/v1"
);
assert.equal(
  normalizeSnowflakeCortexBaseUrl(
    "https://org-account.snowflakecomputing.com/api/v2/cortex/v1/"
  ),
  "https://org-account.snowflakecomputing.com/api/v2/cortex/v1"
);
assert.equal(
  normalizeSnowflakeCortexBaseUrl("org-account"),
  "https://org-account.snowflakecomputing.com/api/v2/cortex/v1"
);
assert.throws(() => normalizeSnowflakeCortexBaseUrl(""), /required/i);

console.log("snowflake-cortex-platform.test.ts: ok");
