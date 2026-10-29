# Amadeus MCP integration (overview)

AIDLC can use two Amadeus MCP servers. Both are **optional convenience**
integrations: every stage produces the same artifacts without them. The plugin
does **not** ship or provision the server definitions. Each developer adds the
servers they need to their own MCP config, so nothing reaches out until they do.

| Server | Fronts | Read/write posture |
|--------|--------|--------------------|
| `octane` | Amadeus Octane (test/quality management) | read-first; writes surface for approval |
| `mcp-gateway` | Unified Amadeus gateway → Confluence, Jira, GitHub, SonarQube | read-first; writes surface for approval |

Detailed, per-backend usage lives alongside this file:
- `okf-knowledge-ingestion.md` — grounding a stage in a named Confluence page, Jira issue, or GitHub file by ingesting it into DocumentKB (via the `aidlc-okf-knowledge-ingest` skill) and reading it back with the `aidlc-knowledge` skill.
- `sonarqube-mcp.md` — SonarQube quality/security evidence via `mcp-gateway`.
- `confluence-mcp.md` — opt-in publish of refined mockups back to a Confluence page (direct write).
- `octane-mcp.md` — the Octane server interface facts and failure modes.

## Configuring the servers (per developer)

MCP configuration is host and machine state, so it lives with the developer,
not in the project. Use the **user-level** config (`~/.kiro/settings/mcp.json`
for Kiro) so it survives engine refreshes and is never committed. The server
names must be exactly `octane` and `mcp-gateway`; the Kiro CLI grants below
refer to them by name.

```json
{
  "mcpServers": {
    "mcp-gateway": {
      "type": "http",
      "url": "https://gateway.mcp.global.amadeus.net/mcp",
      "headers": {
        "x-jira-token": "Token ${JIRA_PAT}",
        "x-sonar-token": "Token ${SONARQUBE_TOKEN}"
      }
    },
    "octane": {
      "type": "http",
      "url": "https://azrnelnx00824.rnd.amadeus.net/mcp"
    }
  }
}
```

Keep credentials out of every `mcp.json`. The `mcp-gateway` entry reads its
personal tokens from environment variables and forwards them as headers: Jira
from `JIRA_PAT` and SonarQube from `SONARQUBE_TOKEN`. Export them where the
harness will read them (`~/.zshenv` on macOS with zsh, `~/.bashrc` for bash, or
a persistent user variable via `setx` on Windows), then reconnect `mcp-gateway`.
Confluence and GitHub need no token; they use the gateway's one-time SSO
sign-in. A missing `SONARQUBE_TOKEN` is not an error: the `sonar_*` reads fail
unauthorized and every stage takes its normal no-SonarQube fallback (see
`sonarqube-mcp.md`).

Reaching the Amadeus endpoints may depend on network position. If a host does
not resolve or connect, check the path in
[AUD](https://viewer.aud.global.amadeus.net/webui/) before assuming the server
is down.

## Kiro CLI: access is per agent

Kiro CLI scopes MCP per agent. A configured server is only usable by an agent
whose `tools` lists it (`@server` or `@server/tool`) and whose config has
`includeMcpJson: true` (which loads the user and workspace `mcp.json`). Only the
agent's `allowedTools` run without a prompt; mcp.json `autoApprove` does not
apply there. A post-compose step (`amadeus-agent-mcp-grants.ts`) merges the
Amadeus tool grants into the core agent configs, re-applies every session, and
reverts cleanly:

| Agent | Servers | Granted tools |
|-------|---------|---------------|
| `aidlc` (conductor) | `octane`, `mcp-gateway` | Octane test tools; Confluence, Jira, GitHub, SonarQube read + Confluence/Jira/PR writes |
| `aidlc-developer-agent` | `mcp-gateway` | Confluence read, GitHub read, SonarQube read |
| `aidlc-architect-agent` | `mcp-gateway` | Confluence read, GitHub read |
| `aidlc-pipeline-deploy-agent` | `mcp-gateway` | Confluence read, GitHub read |

Every other agent, including `amadeus-platform-agent`, gets no Amadeus MCP
tools. Confluence, Jira, and GitHub write tools are granted but not
auto-approved, so they always prompt; the Octane tools are all auto-approved for
the conductor.

AWS core also grants its five servers (`context7`, `aws-mcp`, `aws-pricing`,
`aws-iac`, `aws-serverless`) to every persona. Amadeus does not use them, so on
Kiro CLI the plugin drops their `@<server>` grants from every agent config.
Reverting the plugin puts them back.

The grant map and the removal list live in
`hooks/setup/amadeus-agent-mcp-grants.json`. These steps only run on Kiro CLI.

## Keep auto-approval read-only

Auto-approve only read/reporting and sign-in tools. Write/mutating tools
(create/update Confluence pages, change a SonarQube issue/hotspot status, create
Jira issues or pull requests) must surface for explicit approval, consistent
with the ask-first posture. The one exception is the conductor's Octane test
creation, which runs only after the build-and-test opt-in. Do not add other
write tools to `allowedTools` or `autoApprove`.

## Graceful absence (never block)

Because both servers are optional and user-configured, an agent must **degrade
loudly, never stall**. When a server is not configured, disabled, unreachable,
or unauthorized: attempt the call, and on failure fall back to the stage's
normal inputs, state the skip in one plain status line, and never treat a
missing MCP connection as an error or an approval gate. See each backend doc for
the exact fallback rules.
