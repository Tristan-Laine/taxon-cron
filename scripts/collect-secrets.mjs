#!/usr/bin/env node
// Assemble les deux payloads JSON attendus par les workflows, à partir des
// fichiers locaux déjà présents dans les dossiers des jeux.
//
//   node scripts/collect-secrets.mjs            -> rapport seul, n'écrit rien
//   node scripts/collect-secrets.mjs --write    -> écrit les *.local.json (gitignorés)
//
// Les valeurs ne sont jamais affichées : le rapport ne montre que le nom du jeu,
// sa provenance et la longueur du secret trouvé.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const portfolio = resolve(root, '..')
const sites = JSON.parse(readFileSync(join(root, 'sites.json'), 'utf8'))
const write = process.argv.includes('--write')

// `.env.local` écrit `CRON_SECRET=x`, `vapid-keys.local` écrit
// `  CRON_SECRET           =x`. Une seule regex couvre les deux.
const RE = /^[ \t]*CRON_SECRET[ \t]*=[ \t]*(.+?)[ \t]*$/m

function findSecret(name) {
  for (const file of ['.env.local', 'vapid-keys.local']) {
    const path = join(portfolio, name, file)
    if (!existsSync(path)) continue
    const match = readFileSync(path, 'utf8').match(RE)
    if (match) return { value: match[1], from: file }
  }
  return null
}

const cronSecrets = {}
const missing = []

console.log('CRON_SECRET par jeu\n')
for (const site of sites) {
  const hit = findSecret(site.name)
  if (hit) {
    cronSecrets[site.id] = hit.value
    console.log(`  ok       ${site.id.padEnd(13)} ${hit.from} (${hit.value.length} caracteres)`)
  } else {
    missing.push(site)
    console.log(`  MANQUANT ${site.id.padEnd(13)} a recuperer dans Vercel > ${site.name} > Settings > Environment Variables`)
  }
}

console.log(`\n${Object.keys(cronSecrets).length}/${sites.length} trouves.`)

if (!write) {
  console.log('\nRapport seul. Relancer avec --write pour generer les fichiers.')
  process.exit(0)
}

writeFileSync(join(root, 'cron-secrets.local.json'), JSON.stringify(cronSecrets, null, 2) + '\n')
console.log('\nEcrit: cron-secrets.local.json')

// Gabarit des deploy hooks : aucune source locale, ils vivent uniquement dans
// Vercel. On pré-remplit les clés pour n'avoir qu'à coller les URLs.
const hooksPath = join(root, 'deploy-hooks.local.json')
if (existsSync(hooksPath)) {
  console.log('Conserve: deploy-hooks.local.json (existe deja)')
} else {
  const template = Object.fromEntries(sites.map((s) => [s.id, '']))
  writeFileSync(hooksPath, JSON.stringify(template, null, 2) + '\n')
  console.log('Ecrit:  deploy-hooks.local.json (gabarit a completer)')
}

if (missing.length) {
  console.log(`\nA completer a la main dans cron-secrets.local.json : ${missing.map((s) => s.id).join(', ')}`)
}

console.log(`
Ensuite, pour poser les secrets sur le repo :

  gh secret set CRON_SECRETS --repo Tristan-Laine/taxon-cron < cron-secrets.local.json
  gh secret set DEPLOY_HOOKS --repo Tristan-Laine/taxon-cron < deploy-hooks.local.json
`)
