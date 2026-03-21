#!/usr/bin/env bash
set -e

TEAM_ID="${LINEAR_TEAM_ID:-}"
API_KEY="${LINEAR_API_TOKEN:-}"
GQL="https://api.linear.app/graphql"

if [[ -z "$TEAM_ID" ]]; then
  echo "LINEAR_TEAM_ID is required"
  exit 1
fi

if [[ -z "$API_KEY" ]]; then
  echo "LINEAR_API_TOKEN is required"
  exit 1
fi

gql() {
  curl -s -X POST "$GQL" \
    -H "Authorization: $API_KEY" \
    -H "Content-Type: application/json" \
    -d "$1"
}

create_label() {
  local name="$1" color="$2"
  local payload="{\"query\":\"mutation { issueLabelCreate(input: { name: \\\"${name}\\\", color: \\\"${color}\\\", teamId: \\\"${TEAM_ID}\\\" }) { success issueLabel { id name } } }\"}"
  local result
  result=$(gql "$payload")
  local id
  id=$(echo "$result" | jq -r '.data.issueLabelCreate.issueLabel.id // "ERROR"')
  echo "label:${name}=${id}"
}

echo "=== Creating Labels ==="
create_label "contract"           "#BB87FC"
create_label "schema"             "#4EA7FC"
create_label "api"                "#4EA7FC"
create_label "worker"             "#95A2B3"
create_label "frontend"           "#95A2B3"
create_label "operator-web"       "#95A2B3"
create_label "discord"            "#5865F2"
create_label "settlement"         "#27AE60"
create_label "migration"          "#F2C94C"
create_label "observability"      "#56CCF2"
create_label "docs"               "#95A2B3"
create_label "testing"            "#27AE60"
create_label "security"           "#EB5757"
create_label "infra"              "#95A2B3"
create_label "data"               "#4EA7FC"
create_label "tooling"            "#95A2B3"
create_label "p0"                 "#EB5757"
create_label "p1"                 "#F2994A"
create_label "p2"                 "#F2C94C"
create_label "p3"                 "#95A2B3"
create_label "blocked"            "#EB5757"
create_label "decision-needed"    "#F2C94C"
create_label "cutover-risk"       "#EB5757"
create_label "truth-drift"        "#F2994A"
create_label "external-dependency" "#95A2B3"
create_label "build"              "#4EA7FC"
create_label "refactor"           "#4EA7FC"
create_label "delete"             "#EB5757"
create_label "investigation"      "#BB87FC"
create_label "adr"                "#BB87FC"
create_label "spike"              "#F2C94C"
create_label "bug"                "#EB5757"
create_label "chore"              "#95A2B3"
create_label "codex"              "#0D9373"
create_label "claude"             "#BB87FC"
create_label "chatgpt"            "#74AA9C"
create_label "claude-os"          "#BB87FC"

echo "=== Labels done ==="
