#!/usr/bin/env bash
# Verify GitHub access and inspect both STR repos.
# Prints ONLY metadata. Never prints the token.

set -uo pipefail
source /home/z/my-project/secrets/.gh_env

echo "========================================"
echo "STR Repository Access Verification"
echo "========================================"

CODE_REPO="mayakilzy/SyrianTechRenaissance-Platform"
DOCS_REPO="mayakilzy/repo-info"

echo ""
echo "--- [1] Authenticated user ---"
curl -sS -H "Authorization: token ${GH_TOKEN}" \
     -H "Accept: application/vnd.github+json" \
     "https://api.github.com/user" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('login      :', d.get('login')); print('type       :', d.get('type')); print('scopes hdr :', 'see below')"

echo ""
echo "--- [2] Token scopes (X-OAuth-Scopes) ---"
curl -sSI -H "Authorization: token ${GH_TOKEN}" \
      "https://api.github.com/user" \
  | grep -i '^x-oauth-scopes:' || echo "(no X-OAuth-Scopes header — fine-grained token?)"

echo ""
echo "--- [3] Code repo: ${CODE_REPO} ---"
curl -sS -H "Authorization: token ${GH_TOKEN}" \
     -H "Accept: application/vnd.github+json" \
     "https://api.github.com/repos/${CODE_REPO}" \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
if 'message' in d and d.get('message') != 'Not Found':
    pass
print('full_name        :', d.get('full_name'))
print('private          :', d.get('private'))
print('default_branch   :', d.get('default_branch'))
print('size (KB)        :', d.get('size'))
print('pushed_at        :', d.get('pushed_at'))
print('created_at       :', d.get('created_at'))
print('permissions      :', d.get('permissions'))
print('archived         :', d.get('archived'))
print('disabled         :', d.get('disabled'))
"

echo ""
echo "--- [4] Code repo: branches ---"
curl -sS -H "Authorization: token ${GH_TOKEN}" \
     -H "Accept: application/vnd.github+json" \
     "https://api.github.com/repos/${CODE_REPO}/branches" \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
if isinstance(d, list):
    if not d:
        print('(no branches — repo is empty)')
    for b in d:
        print(' -', b.get('name'), '->', b.get('commit', {}).get('sha', '(no commit)'))
else:
    print('API response:', d)
"

echo ""
echo "--- [5] Code repo: latest commits (if any) ---"
curl -sS -H "Authorization: token ${GH_TOKEN}" \
     -H "Accept: application/vnd.github+json" \
     "https://api.github.com/repos/${CODE_REPO}/commits?per_page=5" \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
if isinstance(d, list):
    if not d:
        print('(no commits — repo is empty)')
    for c in d:
        msg = (c.get('commit', {}).get('message') or '').splitlines()[0]
        print(' -', c.get('sha', '')[:12], '|', msg)
elif isinstance(d, dict) and d.get('message') == 'Git Repository is empty':
    print('(repo is empty — GitHub confirms)')
else:
    print('API response:', d)
"

echo ""
echo "--- [6] Docs repo: ${DOCS_REPO} ---"
curl -sS -H "Authorization: token ${GH_TOKEN}" \
     -H "Accept: application/vnd.github+json" \
     "https://api.github.com/repos/${DOCS_REPO}" \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('full_name        :', d.get('full_name'))
print('private          :', d.get('private'))
print('default_branch   :', d.get('default_branch'))
print('permissions      :', d.get('permissions'))
"

echo ""
echo "--- [7] git ls-remote on code repo (verifies fetch+push auth) ---"
GIT_TERMINAL_PROMPT=0 git ls-remote "https://github.com/${CODE_REPO}.git" 2>&1 | head -20 || true

echo ""
echo "--- [8] git ls-remote on docs repo ---"
GIT_TERMINAL_PROMPT=0 git ls-remote "https://github.com/${DOCS_REPO}.git" 2>&1 | head -20 || true

echo ""
echo "========================================"
echo "Verification complete."
echo "========================================"
