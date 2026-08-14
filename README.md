# taxon-cron

Cron central du portfolio Taxon Games. Ce repo ne contient aucun code de jeu :
uniquement les deux tâches planifiées qui pilotent les 10 DLE.

| Workflow | Cadence (UTC) | Ce qu'il fait |
|---|---|---|
| `push-hourly.yml` | toutes les heures, minute 23 | `GET /api/push-send` sur chaque jeu (nudge "streak at risk") |
| `daily-rebuild.yml` | 10:13 et 10:43 | `POST` sur le deploy hook Vercel de chaque jeu (rollover des pages du jour) |

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

Les URLs de deploy hook Vercel, une par projet.
Vercel → projet → Settings → Git → Deploy Hooks → hook `daily-rebuild`
sur la branche `main`.

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

Depuis ce dossier, avec les deux fichiers JSON préparés en local (ils sont
gitignorés) :

```bash
gh secret set CRON_SECRETS --repo Tristan-Laine/taxon-cron < cron-secrets.local.json
```

```bash
gh secret set DEPLOY_HOOKS --repo Tristan-Laine/taxon-cron < deploy-hooks.local.json
```

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

Pour `daily-rebuild`, la fenêtre horaire n'est en revanche pas négociable :
entre 10:00 et 11:00 UTC, tous les fuseaux de UTC-10 à UTC+13 sont sur la même
date, donc la page d'archive publiée ne peut spoiler personne.
