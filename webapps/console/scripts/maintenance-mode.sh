#!/usr/bin/env bash
# Maintenance-mode helper. Reads/writes the maintenance descriptor in a
# Kubernetes ConfigMap that the console mounts via MAINTENANCE_CONFIG_FILE.
# The console picks up changes within the TTL window (~10s) — no restart.
#
# Requires: kubectl, jq.
#
# Environment overrides:
#   MAINTENANCE_NAMESPACE  k8s namespace          (default: jitsu-platform)
#   MAINTENANCE_CONFIGMAP  ConfigMap name         (default: jitsu-console-maintenance)
#   MAINTENANCE_KEY        Key inside ConfigMap   (default: maintenance.json)

set -euo pipefail

NS="${MAINTENANCE_NAMESPACE:-jitsu-platform}"
CM="${MAINTENANCE_CONFIGMAP:-jitsu-console-maintenance}"
KEY="${MAINTENANCE_KEY:-maintenance.json}"

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: '$1' is required but not installed" >&2
    exit 1
  fi
}
require kubectl
require jq

usage() {
  cat <<EOF
Usage: $(basename "$0") <command>

Commands:
  status   Show the current descriptor.
  start    Turn on maintenance (interactive prompts; pre-fills from current state).
  stop     Set active=false on the existing descriptor (keeps the record).
  edit     Open the current descriptor in \$EDITOR; validates JSON on save.
  delete   Delete the ConfigMap entirely.
  help     Show this help.

Targets ${NS}/${CM} (key: ${KEY}). Override via MAINTENANCE_NAMESPACE / MAINTENANCE_CONFIGMAP / MAINTENANCE_KEY.
EOF
}

# Returns the current descriptor JSON, or empty string if the ConfigMap doesn't exist
# or the key isn't set. We go through -o json + jq rather than jsonpath to avoid
# escaping woes around dots in the key.
read_descriptor() {
  kubectl -n "$NS" get cm "$CM" -o json 2>/dev/null | jq -r --arg key "$KEY" '.data[$key] // ""' 2>/dev/null || true
}

apply_descriptor() {
  local json="$1"
  # Validate JSON before sending it to the cluster.
  if ! echo "$json" | jq . >/dev/null; then
    echo "error: descriptor is not valid JSON" >&2
    return 1
  fi
  # Upsert pattern — create+apply via dry-run YAML so it works whether the
  # ConfigMap exists or not.
  kubectl -n "$NS" create configmap "$CM" \
    --from-literal="${KEY}=${json}" \
    --dry-run=client -o yaml | kubectl apply -f -
}

confirm() {
  local prompt="${1:-Apply?} (y/N) "
  local reply
  read -r -p "$prompt" reply
  case "$reply" in
    [Yy]*) return 0 ;;
    *) return 1 ;;
  esac
}

prompt_with_default() {
  # Usage: prompt_with_default "Label" "default"; reads value into REPLY_VAL.
  local label="$1" default="${2:-}" input
  if [[ -n "$default" ]]; then
    read -r -p "${label} [${default}]: " input
  else
    read -r -p "${label}: " input
  fi
  REPLY_VAL="${input:-$default}"
}

cmd_status() {
  local current
  current="$(read_descriptor)"
  if [[ -z "$current" ]]; then
    echo "No maintenance descriptor at ${NS}/${CM} (key: ${KEY})."
    return 0
  fi
  echo "${NS}/${CM} → ${KEY}:"
  echo "$current" | jq .
}

parse_bool() {
  # Coerce common user input to "true"/"false". Falls back to $2 on unknown.
  case "${1,,}" in
    true|yes|y|1) echo "true" ;;
    false|no|n|0) echo "false" ;;
    *) echo "$2" ;;
  esac
}

cmd_start() {
  local current active visible show_in_advance description
  local planned_start planned_end database_access stop_consuming
  current="$(read_descriptor)"
  active="$(echo "$current" | jq -r '.active // empty' 2>/dev/null || true)"
  visible="$(echo "$current" | jq -r '.visible // empty' 2>/dev/null || true)"
  show_in_advance="$(echo "$current" | jq -r '.show_in_advance // empty' 2>/dev/null || true)"
  description="$(echo "$current" | jq -r '.description // empty' 2>/dev/null || true)"
  planned_start="$(echo "$current" | jq -r '.planned_start // empty' 2>/dev/null || true)"
  planned_end="$(echo "$current" | jq -r '.planned_end // empty' 2>/dev/null || true)"
  database_access="$(echo "$current" | jq -r '.database_access // empty' 2>/dev/null || true)"
  stop_consuming="$(echo "$current" | jq -r '.stop_consuming // empty' 2>/dev/null || true)"

  # `active=true` blocks writes immediately. `active=false` + `show_in_advance=true`
  # is the "schedule an upcoming window" mode: writes still allowed, banner shown.
  prompt_with_default "active (true | false) — block writes now?" "${active:-true}"
  active="$(parse_bool "$REPLY_VAL" "true")"

  prompt_with_default "visible (true | false) — expose descriptor to the browser?" "${visible:-true}"
  visible="$(parse_bool "$REPLY_VAL" "true")"

  # Default show_in_advance to true when scheduling (active=false), otherwise
  # false — for an already-active window the upcoming-banner is redundant.
  local sia_default="${show_in_advance:-}"
  if [[ -z "$sia_default" ]]; then
    if [[ "$active" == "false" ]]; then sia_default="true"; else sia_default="false"; fi
  fi
  prompt_with_default "show_in_advance (true | false) — show banner before the window starts?" "$sia_default"
  show_in_advance="$(parse_bool "$REPLY_VAL" "$sia_default")"

  prompt_with_default "Description" "${description:-Scheduled maintenance}"
  description="$REPLY_VAL"

  prompt_with_default "Planned start (ISO8601, e.g. 2026-06-02T17:00:00Z; blank for none)" "$planned_start"
  planned_start="$REPLY_VAL"

  prompt_with_default "Planned end (ISO8601, e.g. 2026-06-02T18:00:00Z; blank for none)" "$planned_end"
  planned_end="$REPLY_VAL"

  prompt_with_default "database_access (read_only | off)" "${database_access:-read_only}"
  database_access="$REPLY_VAL"
  if [[ "$database_access" != "read_only" && "$database_access" != "off" ]]; then
    echo "error: database_access must be 'read_only' or 'off'" >&2
    exit 1
  fi

  prompt_with_default "stop_consuming (true | false) — pause Rotor/Bulker consumers" "${stop_consuming:-false}"
  stop_consuming="$(parse_bool "$REPLY_VAL" "false")"

  local new_json
  new_json="$(jq -n \
    --argjson active "$active" \
    --argjson visible "$visible" \
    --argjson show_in_advance "$show_in_advance" \
    --arg description "$description" \
    --arg planned_start "$planned_start" \
    --arg planned_end "$planned_end" \
    --arg database_access "$database_access" \
    --argjson stop_consuming "$stop_consuming" \
    '{
      active: $active,
      visible: $visible,
      show_in_advance: $show_in_advance,
      description: $description,
      database_access: $database_access,
      stop_consuming: $stop_consuming
    }
    | if $planned_start != "" then .planned_start = $planned_start else . end
    | if $planned_end != "" then .planned_end = $planned_end else . end')"

  echo
  echo "New maintenance descriptor:"
  echo "$new_json" | jq .
  echo
  if ! confirm; then
    echo "Aborted."
    return 0
  fi
  apply_descriptor "$new_json"
  echo "Applied. The console will pick up the change within ~10s."
}

cmd_stop() {
  local current new_json
  current="$(read_descriptor)"
  if [[ -z "$current" ]]; then
    echo "No maintenance descriptor at ${NS}/${CM} — nothing to stop."
    return 0
  fi
  # Clear both `active` and `show_in_advance` — the in-app banner renders on
  # either flag, so leaving `show_in_advance=true` behind would keep a "Jitsu
  # maintenance is scheduled" message visible after the operator stopped the
  # window. `planned_start` / `planned_end` are kept so the next `start` flow
  # can pre-fill them as sensible defaults.
  new_json="$(echo "$current" | jq '.active = false | .show_in_advance = false')"
  echo "Setting active=false, show_in_advance=false:"
  echo "$new_json" | jq .
  echo
  if ! confirm; then
    echo "Aborted."
    return 0
  fi
  apply_descriptor "$new_json"
  echo "Maintenance stopped. The console will pick up the change within ~10s."
}

cmd_edit() {
  local current tmp
  current="$(read_descriptor)"
  if [[ -z "$current" ]]; then
    # Start from a sensible empty template so $EDITOR doesn't open a blank file.
    current='{"active":false,"visible":true,"description":"","database_access":"read_only"}'
  fi
  tmp="$(mktemp 2>/dev/null || mktemp -t maintenance)"
  trap 'rm -f "$tmp"' EXIT
  # Pretty-print into the temp file so $EDITOR users see indented JSON.
  echo "$current" | jq . > "$tmp"
  "${EDITOR:-vi}" "$tmp"
  if ! jq . "$tmp" >/dev/null; then
    echo "error: edited content is not valid JSON — aborting" >&2
    exit 1
  fi
  echo
  echo "Edited descriptor:"
  jq . "$tmp"
  echo
  if ! confirm; then
    echo "Aborted."
    return 0
  fi
  apply_descriptor "$(jq -c . "$tmp")"
  echo "Applied. The console will pick up the change within ~10s."
}

cmd_delete() {
  if ! kubectl -n "$NS" get cm "$CM" >/dev/null 2>&1; then
    echo "ConfigMap ${NS}/${CM} doesn't exist — nothing to delete."
    return 0
  fi
  if ! confirm "Delete ConfigMap ${NS}/${CM}?"; then
    echo "Aborted."
    return 0
  fi
  kubectl -n "$NS" delete configmap "$CM"
  echo "Deleted. The console will fall back to the MAINTENANCE env var (if set) within ~10s."
}

cmd="${1:-help}"
case "$cmd" in
  status) cmd_status ;;
  start) cmd_start ;;
  stop) cmd_stop ;;
  edit) cmd_edit ;;
  delete) cmd_delete ;;
  help|-h|--help) usage ;;
  *)
    echo "unknown command: $cmd" >&2
    echo >&2
    usage >&2
    exit 1
    ;;
esac
