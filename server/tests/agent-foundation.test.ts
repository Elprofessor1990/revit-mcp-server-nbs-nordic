import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readAgentConfig } from "../src/agent/AgentConfig.js";
import { SqliteAuditSink } from "../src/agent/audit/SqliteAuditSink.js";
import { SqliteWorkflowCache } from "../src/agent/cache/SqliteWorkflowCache.js";
import type { WorkflowPlan } from "../src/agent/types.js";
import { registerTools } from "../src/tools/register.js";

interface ContractSnapshot {
  version: number;
  count: number;
  tools: { name: string; contractHash: string }[];
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)])
    );
  }
  return value;
}

async function captureToolContract(): Promise<ContractSnapshot> {
  const server = new McpServer({ name: "tool-contract-test", version: "1.0.0" });
  const originalError = console.error;
  console.error = () => undefined;
  try {
    await registerTools(server);
  } finally {
    console.error = originalError;
  }
  const client = new Client({ name: "tool-contract-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const response = await client.listTools();
    const tools = response.tools
      .map(tool => ({
        name: tool.name,
        contractHash: createHash("sha256")
          .update(JSON.stringify(canonicalize({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })))
          .digest("hex"),
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
    return { version: 1, count: tools.length, tools };
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
}

function plan(signature: string): WorkflowPlan {
  return {
    schemaVersion: 1,
    intentKind: "test.intent",
    intentSignature: signature,
    catalogFingerprint: "catalog-v1",
    steps: [{ toolId: "get_project_info", argsTemplate: {}, phase: "read" }],
    requiresConfirmation: false,
  };
}

if (process.env.PRINT_TOOL_CONTRACT === "1") {
  process.stdout.write(JSON.stringify(await captureToolContract(), null, 2));
} else {
  test("tool agent feature flag is off by default", () => {
    const config = readAgentConfig({}, "C:\\test-user");
    assert.equal(config.enabled, false);
    assert.equal(config.workflowCachePath, join("C:\\test-user", ".mcp-revit", "workflow-cache.db"));
    assert.equal(config.auditLogPath, join("C:\\test-user", ".mcp-revit", "audit-log.db"));
  });

  test("feature flag off preserves the frozen 151-tool MCP contract", async () => {
    assert.equal(readAgentConfig({ REVIT_MCP_TOOL_AGENT_ENABLED: "false" }).enabled, false);
    const actual = await captureToolContract();
    const expected = JSON.parse(
      readFileSync(join(process.cwd(), "tests", "fixtures", "tool-contract.snapshot.json"), "utf8")
    ) as ContractSnapshot;
    assert.equal(actual.count, 151);
    assert.deepEqual(actual, expected);
  });

  test("workflow cache is versioned, bounded, reusable and disposable", async () => {
    const directory = join(tmpdir(), `revit-agent-cache-${process.pid}-${Date.now()}`);
    const cachePath = join(directory, "workflow-cache.db");
    let now = 1_800_000_000_000;
    const cache = await SqliteWorkflowCache.open({
      filePath: cachePath,
      maxEntries: 2,
      ttlDays: 1,
      minSuccessCountForReuse: 2,
      maxWorkflowSteps: 2,
      now: () => now,
    });
    try {
      assert.equal(cache.schemaVersion(), 1);
      await cache.recordSuccess(plan("one"), 20);
      assert.deepEqual(await cache.lookup("one", "catalog-v1"), []);
      now += 1;
      await cache.recordSuccess(plan("one"), 10);
      assert.deepEqual(await cache.lookup("one", "catalog-v1"), [plan("one")]);
      now += 1;
      await cache.recordSuccess(plan("two"), 10);
      now += 1;
      await cache.recordFailure(plan("three"), "test_failure");
      assert.deepEqual(await cache.lookup("one", "catalog-v1"), []);
      await assert.rejects(
        cache.recordSuccess({ ...plan("too-long"), steps: [
          ...plan("too-long").steps,
          ...plan("too-long").steps,
          ...plan("too-long").steps,
        ] }, 10),
        /step cache limit/
      );
      now += 24 * 60 * 60 * 1000 + 1;
      await cache.prune();
      assert.deepEqual(await cache.lookup("two", "catalog-v1"), []);
      await cache.clear();
    } finally {
      cache.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("cache and audit use separate schema-versioned files", async () => {
    const directory = join(tmpdir(), `revit-agent-stores-${process.pid}-${Date.now()}`);
    const cachePath = join(directory, "workflow-cache.db");
    const auditPath = join(directory, "audit-log.db");
    const cache = await SqliteWorkflowCache.open({ filePath: cachePath });
    const audit = await SqliteAuditSink.open({ filePath: auditPath });
    try {
      assert.equal(cache.schemaVersion(), 1);
      assert.equal(audit.schemaVersion(), 1);
      assert.notEqual(cachePath, auditPath);
      await audit.append({
        timestamp: Date.now(),
        runId: "run-1",
        intentKind: "test.intent",
        toolId: "set_element_parameters",
        targetKind: "element",
        targetId: "element-1",
        oldValue: "old",
        newValue: "new",
        outcome: "success",
        verified: true,
      });
    } finally {
      cache.close();
      audit.close();
    }
    rmSync(cachePath, { force: true });
    assert.equal(existsSync(cachePath), false);
    assert.equal(existsSync(auditPath), true);
    const reopened = await SqliteWorkflowCache.open({ filePath: cachePath });
    try {
      assert.equal(reopened.schemaVersion(), 1);
      assert.deepEqual(await reopened.lookup("missing", "catalog-v1"), []);
    } finally {
      reopened.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
