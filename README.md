# taxon-cron

Cron central du portfolio Taxon Games. Ce repo ne contient aucun code de jeu :
uniquement les deux tâches planifiées qui pilotent les 10 DLE.

| Workflow | Cadence (UTC) | Ce qu'il fait |
|---|---|---|
| `push-hourly.yml` | toutes les heures, minute 23 | `GET /api/push-send` sur chaque jeu (nudge "streak at risk") |
| `daily-rebuild.yml` | 10:13 et 10:43 (en pratique l'après-midi) | `POST` sur le deploy hook Vercel de chaque jeu (rollover des pages du jour), **une seule fois par jour** : le second run s'arrête si le premier a réussi |

En plus, depuis le 2 novembre 2026, un petit Worker Cloudflare (`push-worker/`, nom
`taxon-push`) lance `GET /api/push-send` chaque heure, minute 5, sur les jeux encore
chez Vercel. GitHub ne lançait `push-hourly.yml` que 4 à 6 fois par jour, or chaque
route n'envoie qu'à 21 h locale : à Paris, 4 soirées sur 19 étaient couvertes
(14 octobre au 1er novembre). Un jeu passé chez Cloudflare a son propre déclencheur
dans son Worker : `"push": false` sur sa ligne de `sites.json`, et ce Worker ne
l'appelle plus. Quand les 10 y sont, supprimer `taxon-push`. Le reconstruire : voir
`push-worker/wrangler.jsonc`. Vérifier un passage sans rien envoyer de plus :
`npx wrangler tail taxon-push` autour de la minute 5, jamais `?force=1`.

## Pourquoi ce repo existe

GitHub facture **une minute entamée par job**, pas le temps réel. Un `curl` de
3 secondes coûte donc exactement le même prix qu'un build complet de 48 secondes.

Avant : chaque DLE avait ses propres `push-cron.yml` + `daily-rebuild.yml`, soit
**26 jobs par jour et par repo × 10 repos = 260 jobs/jour**, pour ne rien faire
d'autre que 10 requêtes HTTP par heure. Résultat mesuré du 1er au 14 août 2026 :
1775 minutes facturées sur les 2000 incluses, en 14 jours.

Après : **26 jobs par jour au total**. Même travail, ~780 min/mois.

Ajouter un jeu au portfolio ne coûte donc plus rien en minutes Actions.

## Ajouter ou retirer un jeu

1. Éditer `sites.json` (`id`, `name`, `domain`).
2. Ajouter la clé correspondante dans les deux secrets ci-dessous.

Un jeu présent dans `sites.json` mais absent d'un secret est **ignoré avec un
warning**, pas une erreur : on peut donc ajouter le site d'abord et les secrets
ensuite. En revanche il ne sera pas pingé tant que le secret manque.

## Secrets à configurer

Deux secrets de repo, chacun un objet JSON dont les clés sont les `id` de
`sites.json`.

### `CRON_SECRETS`

Les tokens `CRON_SECRET`, identiques à la variable d'environnement du même nom
côté Vercel pour chaque projet.

```json
{
  "apexdle": "...",
  "dbdle": "...",
  "deadlockdle": "...",
  "forhonordle": "...",
  "overwatchdle": "...",
  "r6dle": "...",
  "rivalsdle": "...",
  "sf6dle": "...",
  "tekkendle": "...",
  "valdle": "..."
}
```

### `DEPLOY_HOOKS`

Les URLs de deploy hook, une par projet. Vercel → projet → Settings → Git →
Deploy Hooks → hook `daily-rebuild` sur la branche `main`.
Sauf `overwatchdle`, sur Cloudflare depuis le 2026-10-30 : Workers & Pages →
`overwatchdle` → Settings → Builds → Deploy Hooks, branche `main`
(`https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/...`).

```json
{
  "apexdle": "https://api.vercel.com/v1/integrations/deploy/...",
  "...": "..."
}
```

Ces URLs **sont** des credentials : qui les a peut déclencher un déploiement.
Les workflows les passent par `::add-mask::` avant tout `curl` pour qu'elles
n'apparaissent pas dans les logs en cas d'erreur.

### Les poser

`scripts/collect-secrets.mjs` assemble les payloads à partir des `.env.local` et
`vapid-keys.local` déjà présents dans les dossiers des jeux. Il n'affiche jamais
une valeur, seulement sa provenance et sa longueur.

```bash
node scripts/collect-secrets.mjs
```

Sans argument il ne fait qu'un rapport. Avec `--write` il génère
`cron-secrets.local.json` (rempli) et `deploy-hooks.local.json` (gabarit vide, ces
URLs n'existent que dans Vercel). Les deux fichiers sont gitignorés.

Au 14 août 2026, 7 jeux sur 10 sont résolus automatiquement. `rivalsdle`,
`tekkendle` et `valdle` n'ont pas de `CRON_SECRET` exploitable en local : les
récupérer dans Vercel → projet → Settings → Environment Variables.

Puis :

```bash
gh secret set CRON_SECRETS --repo Tristan-Laine/taxon-cron < cron-secrets.local.json
```

```bash
gh secret set DEPLOY_HOOKS --repo Tristan-Laine/taxon-cron < deploy-hooks.local.json
```

Un token erroné ne passe pas inaperçu : la route répond 401, le job liste le jeu
fautif et se termine en erreur.

## Tester sans attendre le cron

```bash
gh workflow run push-hourly.yml --repo Tristan-Laine/taxon-cron
```

Les deux workflows loguent une ligne `ok <id>` par jeu et se terminent en erreur
en listant les jeux qui ont échoué, sans jamais interrompre la boucle.

## Fiabilité des crons

Les minutes rondes (`:00`, `:10`) sont les créneaux les plus chargés de GitHub et
les runs y sont fréquemment supprimés en silence. Les anciens crons par repo,
tous calés sur `0 * * * *`, ne tournaient qu'entre 33 % et 65 % du temps. D'où
les minutes 23 / 13 / 43. Ne pas les ramener sur des minutes rondes.

Pour `daily-rebuild`, seule la limite basse compte : un build **avant 10:00 UTC**
pourrait spoiler UTC-10, qui n'a pas encore fini la veille. Après, c'est sans
risque, juste un peu moins frais. Et c'est ce qui se passe : du 27 août au
10 septembre 2026, GitHub a lancé ces deux runs entre 13:27 et 21:14 UTC, à
4 à 20 minutes d'intervalle.

Le second run interroge l'historique GitHub et s'arrête si un rebuild a déjà
réussi aujourd'hui après 10:00 UTC. Il ne sert donc que le jour où GitHub saute
le premier. Si les deux sautent, rien ne tourne et rien ne le signale. Détails
dans l'en-tête du workflow.
