import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "../../src/tools/register.js";
import { PLAN_CATALOG_VERSION } from "../../src/tools/orchestrate_workflow.js";
import { IntentRouter } from "../../src/agent/IntentRouter.js";
import { ROUTING_TOOL_IDS, ToolCatalog } from "../../src/agent/ToolCatalog.js";

async function session(flag: string | undefined) {
  const server = new McpServer({ name: "entrypoint-test", version: "1" });
  const oldFlag = process.env.REVIT_MCP_TOOL_AGENT_ENABLED;
  const oldError = console.error;
  try {
    if (flag === undefined) delete process.env.REVIT_MCP_TOOL_AGENT_ENABLED;
    else process.env.REVIT_MCP_TOOL_AGENT_ENABLED = flag;
    console.error = () => undefined;
    await registerTools(server);
  } finally {
    console.error = oldError;
    if (oldFlag === undefined) delete process.env.REVIT_MCP_TOOL_AGENT_ENABLED;
    else process.env.REVIT_MCP_TOOL_AGENT_ENABLED = oldFlag;
  }
  const client = new Client({ name: "entrypoint-client", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(a), server.connect(b)]);
  return { client, close: () => Promise.all([client.close(), server.close()]) };
}

test("flag absent/off omits entrypoint; on adds exactly one tool and preserves existing schemas", async () => {
  const off = await session("false"), absent = await session(undefined), on = await session("true");
  try {
    const baseline = (await off.client.listTools()).tools;
    assert.equal(baseline.length, 151);
    assert.ok(!baseline.some(t => t.name === "orchestrate_workflow"));
    assert.deepEqual((await absent.client.listTools()).tools, baseline);
    const enabled = (await on.client.listTools()).tools;
    assert.equal(enabled.length, 152);
    assert.deepEqual(enabled.filter(t => t.name !== "orchestrate_workflow"), baseline);
  } finally { await Promise.all([off.close(), absent.close(), on.close()]); }
});

test("MCP plan results equal direct routing for all four intents and unknown fallback", async () => {
  const s = await session("true");
  const router = new IntentRouter(new ToolCatalog(PLAN_CATALOG_VERSION, ROUTING_TOOL_IDS));
  try {
    for (const intent of [
      "Ændr højden på de valgte vægge til 3200 mm.",
      "Opret en schedule for vægge med Type, Instance, bygningsdelsnummer og areal.",
      "Omdøb de valgte typer efter denne navnestandard: [regel].",
      "Synkroniser bygningsdelsnummer L%AD001 fra NBS til de valgte Revit-elementer.",
      "Create a roof",
    ]) {
      const result = await s.client.callTool({ name: "orchestrate_workflow", arguments: { mode: "plan", intent } });
      assert.ok(!result.isError);
      const content = result.content as { type: string; text: string }[];
      assert.deepEqual(JSON.parse(content[0].text), router.route(intent));
    }
  } finally { await s.close(); }
});

test("execute without prior confirmation and missing mode fail explicitly", async () => {
  const s = await session("true");
  try {
    for (const args of [{ mode: "execute", intent: "Create a roof" }, { intent: "Create a roof" }]) {
      try {
        const result = await s.client.callTool({ name: "orchestrate_workflow", arguments: args });
        assert.equal(result.isError, true);
        assert.match(JSON.stringify(result.content), /plan|mode/i);
      } catch (error) {
        // SDK versions may surface input validation as a protocol error.
        if (error instanceof assert.AssertionError) throw error;
        assert.match(String(error), /plan|mode/i);
      }
    }
  } finally { await s.close(); }
});
