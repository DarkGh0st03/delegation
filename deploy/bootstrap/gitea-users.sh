#!/bin/sh
# One-shot: create the Gitea accounts (admin, Gateway, Runner, staging deployer) with the
# Gitea CLI. Runs in the Gitea image as uid 1000 against the same data volume.
# Idempotent: existing accounts are kept unchanged.
set -eu

config=/config/local.env
[ -f "$config" ] || { echo "Missing $config: the setup service must run first" >&2; exit 1; }
value() { awk -F= -v k="$1" '$1==k{print substr($0,length(k)+2)}' "$config"; }

for _ in $(seq 1 90); do
  wget -qO- http://gitea:3000/api/healthz >/dev/null 2>&1 && break
  sleep 1
done

existing="$(gitea admin user list 2>/dev/null | awk 'NR>1{print $2}')"

ensure() {
  user="$1"; password="$2"; email="$3"; admin="$4"
  if printf '%s\n' "$existing" | grep -qx "$user"; then
    echo "Gitea user already exists: $user"
    return 0
  fi
  echo "Creating Gitea user: $user"
  if [ "$admin" = "admin" ]; then
    gitea admin user create --username "$user" --password "$password" --email "$email" \
      --admin --must-change-password=false
  else
    gitea admin user create --username "$user" --password "$password" --email "$email" \
      --must-change-password=false
  fi
}

ensure "$(value GITEA_ADMIN_USER)" "$(value GITEA_ADMIN_PASSWORD)" "$(value GITEA_ADMIN_EMAIL)" admin
ensure "$(value GITEA_GATEWAY_USER)" "$(value GITEA_GATEWAY_PASSWORD)" "$(value GITEA_GATEWAY_EMAIL)" user
ensure "$(value GITEA_RUNNER_USER)" "$(value GITEA_RUNNER_PASSWORD)" "$(value GITEA_RUNNER_EMAIL)" user
ensure "$(value GITEA_DEPLOYER_USER)" "$(value GITEA_DEPLOYER_PASSWORD)" "$(value GITEA_DEPLOYER_EMAIL)" user
echo "Gitea accounts ready."
