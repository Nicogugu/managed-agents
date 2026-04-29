# CLAUDE.md

Instructions pour les futures sessions Claude Code dans ce repo.

## Quoi est ce projet

Article Code — agent IA éditorial pour WordPress, déployé sur VPS Hostinger derrière Traefik. Le `README.md` contient l'architecture complète, les protocoles UI, et la doc utilisateur. **Lis-le d'abord** pour comprendre le pourquoi des choix.

## Live

- **App** : https://agent.76.13.59.178.nip.io (Basic Auth — credentials dans GitHub secrets `AUTH_USER` / `AUTH_PASS`)
- **WP cible** : https://wp.76.13.59.178.nip.io (admin / `WP_APP_PASSWORD` secret)
- **GitHub** : https://github.com/Nicogugu/managed-agents (branche prod: `claude/bootstrap-project-BsFvC` — pas encore mergée en main)

## Déploiement

**100% automatique** via `.github/workflows/deploy.yml`. À chaque `git push` sur `main` ou `claude/bootstrap-project-BsFvC` :

1. Workflow SSH dans la VPS via clé `github-actions-deploy@managed-agents` (ed25519, déposée via API Hostinger)
2. `git fetch + reset --hard` la branche
3. **Restart Traefik** (pour purger un éventuel panic loop hérité — tic post-mortem mid-2026)
4. Réécrit `/opt/managed-agents/deploy/.env` depuis les secrets CI (transit base64 pour éviter les expansions `$$` shell — voir ci-dessous)
5. `docker compose -f docker-compose.local.yml up -d --build`
6. Smoke test : `/api/health` doit être 200 (public), `/api/sessions` doit être 401 (auth requise)

**Pour déployer** : `git push origin claude/bootstrap-project-BsFvC`. Aucune action manuelle requise.

**Watch deploy** : demande à l'utilisateur son GitHub PAT (scope `repo`) si tu n'en as pas, puis :
```bash
PAT='<demande au user>'  # PAT GitHub avec scope repo
RUN_ID=$(curl -fsS -H "Authorization: token $PAT" \
  "https://api.github.com/repos/Nicogugu/managed-agents/actions/runs?branch=claude/bootstrap-project-BsFvC&per_page=1" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['workflow_runs'][0]['id'])")
until s=$(curl -fsS -H "Authorization: token $PAT" \
  "https://api.github.com/repos/Nicogugu/managed-agents/actions/runs/$RUN_ID" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(f\"{d['status']}|{d.get('conclusion','-')}\")") \
  && [[ "$s" == *"completed"* ]]; do sleep 12; done
echo "$s"
```

Sinon, watch directement sur https://github.com/Nicogugu/managed-agents/actions.

## Secrets CI (GitHub Actions)

Tous stockés en encrypted secrets sur le repo. Si tu en ajoutes un nouveau :
1. Encode avec libsodium-wrappers + la clé publique du repo (récupérée via `GET /repos/Nicogugu/managed-agents/actions/secrets/public-key`)
2. PUT sur `/repos/Nicogugu/managed-agents/actions/secrets/{name}` avec `{encrypted_value, key_id}`

Liste actuelle :
| Secret | Usage |
|---|---|
| `SSH_PRIVATE_KEY` | Clé privée ed25519 pour SSH vers VPS |
| `VPS_HOST` | `76.13.59.178` |
| `VPS_USER` | `root` |
| `VPS_IP` | `76.13.59.178` (utilisé dans Traefik labels) |
| `ANTHROPIC_API_KEY` | sk-ant-... |
| `WP_BASE_URL` | URL WordPress |
| `WP_USER_LOGIN` | username admin WP |
| `WP_APP_PASSWORD` | Application Password WP (24 chars) |
| `GEMINI_API_KEY` | AIza... |
| `AUTH_USER` | username Basic Auth de l'app |
| `AUTH_PASS` | password Basic Auth de l'app |

## Pièges connus (post-mortem)

### 1. SSH transit + caractères spéciaux dans les secrets

**Symptôme** : la valeur reçue côté VPS est différente de la valeur du secret. Caractères qui ressemblent à des variables (`$2y`, `$0`, `$5`) deviennent des sous-strings (`$0`=`bash`, `$5`=vide…).

**Cause** : SSH transmet la commande comme STRING. Le shell remote parse la ligne `EDITOR_AUTH_USERS=admin:$2y$05$...` AVANT toute autre chose, et expand les `$N` comme positional args.

**Fix** : encoder les secrets en base64 sur le runner GitHub avant `ssh` (`B64_FOO=$(printf %s "$FOO" | base64 -w0)`), passer en env, décoder sur la VPS via `$(echo "$B64_FOO" | base64 -d)`.

C'est implémenté dans `.github/workflows/deploy.yml`.

### 2. Traefik basicauth panic

**Symptôme** : tout 404 sur tous les domaines hébergés sur la VPS, pas seulement notre app.

**Cause** : Traefik panique au build du middleware basicauth si la valeur `users` est mal formée (ex: hash bcrypt avec `$$` non escapé correctement, ou hash corrompu via piège #1). Le panic est PERSISTANT — Traefik garde le mauvais state même après que tu retires les labels.

**Fix actuel** : auth gérée par Express middleware côté server (`server/src/app.ts`), pas Traefik. + `docker restart traefik-traefik-1` au début du deploy pour casser un éventuel panic loop hérité.

**Si tu veux ré-essayer Traefik basicauth** : utilise `usersfile` (mount un fichier htpasswd) au lieu de `users` (env-var via labels). Beaucoup plus robuste.

### 3. Memory store seed écrase le contenu dynamique

**Symptôme** : les leçons que l'agent ajoute à `lessons.md` ou les articles à `articles/index.md` disparaissent au prochain deploy.

**Cause** : `seedMemoryStore()` upsert tous les seeds par défaut.

**Fix** : `DYNAMIC_PATHS = {/lessons.md, /articles/index.md}` dans `server/src/anthropic.ts`. Pour ces paths, on `create` si manquant mais on n'`update` jamais. Voir le commit `319c80b`.

**Récupérer une version perdue** : Anthropic garde 30j d'audit trail.
```ts
const versions = await client.beta.memoryStores.memoryVersions.list(STORE_ID);
const v = await client.beta.memoryStores.memoryVersions.retrieve(versionId, { memory_store_id });
await client.beta.memoryStores.memories.update(memoryId, { memory_store_id, content: v.content });
```

### 4. Token streaming non disponible

L'API Anthropic Managed Agents v2 ne stream pas les tokens — `agent.message` arrive d'un bloc avec le texte complet. On simule un typewriter côté client (`useSession.ts:enqueueTypewriterReveal`). Issue upstream : https://github.com/anthropics/claude-code/issues/41732.

**Important** : flush le typewriter AVANT d'insérer un nouveau tool block, sinon le markdown se split entre 2 blocs texte (`**Phase: P` puis `LAN**...`) et ReactMarkdown affiche du raw markdown. Voir `flushTypewriter()` dans `useSession.ts`.

## Workflow de dev

### Tests
```bash
cd server && npm test       # vitest, 12 tests
cd web && npm test -- --run # vitest, 15 tests
```

### Type check
```bash
cd server && npx tsc --noEmit
cd web && npx tsc --noEmit
```

### Local
```bash
# .env requis dans server/
cd server && npm run dev    # http://localhost:3001
cd web && npm run dev       # http://localhost:5180 (proxy /api → 3001)
```

### Restaurer manuellement de la mémoire (nécessite ANTHROPIC_API_KEY)
Le pattern est dans le commit `319c80b` qui a restauré `articles/index.md` après un bug de seed.

## Conventions de commit

Format observé sur la branche :
- `feat(scope): one-line summary` — nouvelle fonctionnalité
- `fix(scope): summary` — bug fix
- `refactor(scope): summary` — refacto sans changement fonctionnel
- `perf(scope): summary` — performance
- `docs(scope): summary` — documentation
- `ci(scope): summary` — CI/CD
- `debug: summary` — instrumentation temporaire

Le commit message inclut un context/explication détaillé en body, et finit par :
```
https://claude.ai/code/session_015kKxDFgKGPvyadmAdMtPLv
```

## Limites SDK Anthropic actuelles (v0.91.1)

Le SDK a des fonctionnalités qui nécessitent un cast `as any` pour fonctionner côté TypeScript :
- `client.beta.memoryStores.*` (toute la famille)
- `client.beta.sessions.events.list()` (manque dans le typage)
- `client.beta.sessions.events.send()` avec `user.custom_tool_result` event
- Custom tools schema attaché à `agents.create`

Quand le SDK sera mis à jour, ces casts pourront être retirés. Cherche `(client.beta as any)` dans le code pour les trouver.

## Vérifier l'état de prod rapidement

```bash
# Health (public, pas d'auth)
curl https://agent.76.13.59.178.nip.io/api/health

# Stats journalières (auth requise — demande creds au user)
curl -u "$AUTH_USER:$AUTH_PASS" https://agent.76.13.59.178.nip.io/api/admin/stats

# Liste WP posts (auth Express)
curl -u "$AUTH_USER:$AUTH_PASS" https://agent.76.13.59.178.nip.io/api/wp/posts?per_page=5
```

## Quoi NE PAS faire

- ❌ **Ne pas** push sur `main` directement — la branche prod actuelle est `claude/bootstrap-project-BsFvC`
- ❌ **Ne pas** réintroduire le middleware Traefik basicauth (cf. piège #2)
- ❌ **Ne pas** stocker des hashes bcrypt dans des secrets passés via SSH sans base64 (cf. piège #1)
- ❌ **Ne pas** ajouter `lessons.md` ou `articles/index.md` au seed sans les marquer DYNAMIC (cf. piège #3)
- ❌ **Ne pas** émettre `wp-post` block ET `wp_publish` tool dans le même turn — créera un doublon WP malgré la dedup serveur
- ❌ **Ne pas** committer/pusher sans demander l'utilisateur
