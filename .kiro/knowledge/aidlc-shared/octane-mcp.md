# Octane MCP reference (optional)

Concrete interface facts for the Amadeus Octane MCP service. Octane is an
**optional** test/quality-management integration reached through the **`octane`**
MCP server. It is not shipped with the plugin; a developer adds it to their own
`mcp.json` and signs in when they need it. Kept separate from methodology so these facts can change without
altering how any agent reasons.

## Server

- MCP server name in config: `octane`
- Endpoint: `https://azrnelnx00824.rnd.amadeus.net/mcp`  *(an **RND** host —
  reachability may depend on network position; check
  [AUD](https://viewer.aud.global.amadeus.net/webui/) before assuming it is down)*
- Transport: `http`

MCP servers are session-wide and inherited by every agent; there is no per-agent
grant to author. The server's `autoApprove` set covers only read/scope/sign-in
tools (`octane_ping`, `octane_get_active_scope`, `octane_set_active_scope`,
`octane_check_workspace_access`, `octane_sso_login`, `octane_sso_login_complete`,
`octane_find_by_name`, `octane_get_all_linked_tests`) plus the create/link tools
Amadeus has cleared for pre-approval (`octane_create_manual_test`,
`octane_create_gherkin_test`, `octane_link_test_to_work_item`). Any other
mutating call surfaces for approval.

## Scoping identifiers

Queries almost always need scoping, or they return far too much. Set the active
scope with `octane_set_active_scope` before querying.

- Workspace ID: _TODO(amadeus)_
- Project / shared-space ID: _TODO(amadeus)_
- Release or sprint identifier to scope to: _TODO(amadeus)_
- How to scope to "the area under change": _TODO(amadeus)_

## Entity and field names

Octane instances differ in which fields are populated and what they are called.
Record the ones that matter here.

| Entity | ID field | Name field | Fields that matter | Notes |
| --- | --- | --- | --- | --- |
| requirement | _TODO_ | | | join key to AI-DLC requirements |
| test case | _TODO_ | | | |
| test set | _TODO_ | | | |
| run | _TODO_ | | | |
| defect | _TODO_ | | | |

## Write access

Default posture is **read-first**. The pre-approved writes are limited to
creating manual/Gherkin tests and linking a test to a work item; record
explicitly what else automation may write, if anything.

| Entity | Writable from automation? | Requires which approval |
| --- | --- | --- |
| manual/Gherkin test | yes (auto-approved create) | none beyond session |
| test↔work-item link | yes (auto-approved) | none beyond session |
| _other_ | _TODO(amadeus)_ | surfaces for approval |

## Readiness: detect by attempting

Do not introspect whether Octane is "connected"; issue a call (e.g.
`octane_ping` or `octane_get_active_scope`). If the `octane_*` tools cannot be
issued at all, the server is disabled or not registered — fall back. If a call
errors or sign-in is incomplete, fall back.

## Failure modes (distinguish them — they license different conclusions)

| Symptom | Means | Correct reporting |
| --- | --- | --- |
| Connection error / timeout | Server unreachable | coverage **unknown**; `octane_available: false` |
| Empty result, authorised | No coverage recorded | coverage **absent**; cite the query |
| Permission denied | Coverage may exist, not visible | coverage **not assessable**; never report as absent |
| Malformed / partial response | Instance or schema drift | report and stop; do not infer |

Reporting "not assessable" (permission denied) as "absent" (authorised, empty) is
a false clean bill of health. A run that could not reach Octane is a valid run
with a loud caveat; a run that quietly invented coverage is a defect that
surfaces at audit.

_TODO(amadeus): record what each failure actually looks like from this server,
and fill in the scoping/entity/field facts above, so agents can rely on them
without runtime discovery._
