#!/usr/bin/env bash
# Secure GitHub credentials setup for STR Platform G01.
# Reads the obfuscated token from the secrets dir, deobfuscates by removing '+',
# stores it in a 600-perms git-credentials file, and configures git to use it.
# NEVER prints the token. Only prints boolean status + repo metadata.

set -euo pipefail

SECRETS_DIR="/home/z/my-project/secrets"
RAW_FILE="${SECRETS_DIR}/GeneralGH_extracted/General GH.md"
CRED_FILE="${SECRETS_DIR}/.git-credentials"
NETRC_FILE="${SECRETS_DIR}/.netrc"
GITCONFIG_EXTRA="${SECRETS_DIR}/.gitconfig.extra"

mkdir -p "${SECRETS_DIR}"
chmod 700 "${SECRETS_DIR}"

# Deobfuscate: remove every '+' character from the FIRST line of the raw file.
# The first line is the token with '+' noise inserted.
TOKEN=$(head -n1 "${RAW_FILE}" | tr -d '+' | tr -d '[:space:]')

# Validate token shape (classic PAT: ghp_ + 36 chars). Do NOT print the token.
if [[ ! "${TOKEN}" =~ ^ghp_[A-Za-z0-9]{36}$ ]]; then
  echo "TOKEN_SHAPE_INVALID"
  exit 1
fi

# Write git-credentials file: https://mayakilzy:TOKEN@github.com
# git credential store reads this format.
umask 077
cat > "${CRED_FILE}" <<EOF
https://mayakilzy:${TOKEN}@github.com
EOF
chmod 600 "${CRED_FILE}"

# Also expose the token via an env file that other scripts can source safely.
cat > "${SECRETS_DIR}/.gh_env" <<EOF
export GH_TOKEN="${TOKEN}"
export GH_USER="mayakilzy"
EOF
chmod 600 "${SECRETS_DIR}/.gh_env"

# Configure git globally to use this credential store.
git config --global credential.helper "store --file=${CRED_FILE}"
git config --global user.name "GLM (STR Platform)"
git config --global user.email "glm-str@users.noreply.github.com"
git config --global init.defaultBranch main
git config --global pull.rebase false

echo "CREDS_SETUP_OK"
echo "CRED_FILE=${CRED_FILE}"
