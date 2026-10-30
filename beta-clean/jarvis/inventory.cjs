"use strict";
// Emits contracts only; no database requests, credentials or scheduler startup.
const { z } = require("zod/v3");
const { zodToJsonSchema } = require("zod-to-json-schema");
const { schemas, scopes, outputSchemas } = require("./contracts");
const { descriptions } = require("./tools");
const { createProjects } = require("../projects/server");
const legacy = createProjects({ pool: {}, jarvisEnabled: false }).tools({
  userId: "00000000-0000-4000-8000-000000000001",
  scopes: ["projects:read", "projects:write"],
});
const tools = legacy.map(([name, description, input, write]) => ({
  name,
  description,
  requiredScopes: [write ? "projects:write" : "projects:read"],
  inputSchema: zodToJsonSchema(z.object(input).strict()),
  generation: "existing_projects",
}));
for (const [name, input] of Object.entries(schemas))
  tools.push({
    name,
    description: descriptions[name],
    requiredScopes: scopes[name],
    conditionalScopes:
      name === "habits_create"
        ? "reminderPlan requires notifications:write"
        : name.startsWith("activity_")
          ? "habit link requires habits:write; project link requires projects:read when creating"
          : null,
    inputSchema: zodToJsonSchema(input),
    outputSchema: zodToJsonSchema(outputSchemas[name]),
    generation: "candidate_jarvis2",
  });
process.stdout.write(
  JSON.stringify(
    {
      status: "candidate_not_deployed",
      existing: legacy.length,
      added: Object.keys(schemas).length,
      total: tools.length,
      tools,
    },
    null,
    2,
  ) + "\n",
);
