#!/usr/bin/env node
// Contrôle les deux fichiers *.local.json AVANT de les envoyer sur GitHub.
//
//   node scripts/check-secrets.mjs
//
// Ne fait aucun appel réseau et n'affiche jamais une valeur : uniquement des
// verdicts. Cherche les erreurs typiques d'un remplissage à la main, dont la
// plus vicieuse : la même valeur collée deux fois, qui ne produit aucune erreur
// mais fait pointer un jeu vers le site d'un autre.

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sites = JSON.parse(readFileSync(join(root, 'sites.json'), 'utf8'))
const ids = sites.map((s) => s.id)

let errors = 0
let warnings = 0
const fail = (m) => { console.log(`  ERREUR   ${m}`); errors++ }
const warn = (m) => { console.log(`  ATTENTION ${m}`); warnings++ }

function load(file) {
  const path = join(root, file)
  if (!existsSync(path)) { fail(`${file} introuvable`); return null }
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (e) {
    fail(`${file} n'est pas un JSON valide (${e.message}). Une virgule ou un guillemet manque.`)
    return null
  }
}

/** Contrôles communs aux deux fichiers. */
function checkShape(file, data, { validate }) {
  console.log(`\n${file}`)

  for (const id of ids) if (!(id in data)) fail(`${id} absent du fichier`)
  for (const key of Object.keys(data)) if (!ids.includes(key)) warn(`${key} inconnu (absent de sites.json)`)

  const seen = new Map()
  let ok = 0

  for (const id of ids) {
    const raw = data[id]
    if (raw === undefined) continue
    if (typeof raw !== 'string') { fail(`${id} n'est pas du texte`); continue }
    if (raw === '') { fail(`${id} est vide`); continue }
    if (raw !== raw.trim()) warn(`${id} a un espace au début ou à la fin (le copier-coller en ajoute souvent)`)

    const value = raw.trim()
    if (seen.has(value)) { fail(`${id} a EXACTEMENT la même valeur que ${seen.get(value)} : un copier-coller a derapé`); continue }
    seen.set(value, id)

    const problem = validate(value, id)
    if (problem) { fail(`${id} : ${problem}`); continue }
    ok++
  }

  console.log(`  -> ${ok}/${ids.length} valides`)
}

console.log('Controle des fichiers locaux (aucune valeur affichee, aucun appel reseau)')

const cron = load('cron-secrets.local.json')
if (cron) {
  checkShape('cron-secrets.local.json', cron, {
    validate: (v) => {
      if (v.startsWith('http')) return 'ressemble a une URL, pas a un token (fichiers inverses ?)'
      if (/\s/.test(v)) return 'contient un espace, un token n\'en a pas'
      if (v.length < 16) return `seulement ${v.length} caracteres, c'est court pour un token`
      return null
    },
  })
}

const hooks = load('deploy-hooks.local.json')
if (hooks) {
  checkShape('deploy-hooks.local.json', hooks, {
    validate: (v) => {
      if (!v.startsWith('https://')) return 'ne commence pas par https://'
      let url
      try { url = new URL(v) } catch { return 'URL illisible' }
      if (!url.hostname.endsWith('vercel.com')) return `pointe vers ${url.hostname}, attendu api.vercel.com`
      if (!url.pathname.includes('/integrations/deploy/')) return 'ne ressemble pas a un deploy hook Vercel'
      return null
    },
  })
}

console.log(`\n${errors} erreur(s), ${warnings} avertissement(s).`)

// --live : teste les tokens contre les vraies routes. Sans effet de bord notable,
// /api/push-send n'envoie qu'aux joueurs pile dans leur creneau du soir, ce que
// le cron declenchait de toute facon 24 fois par jour.
// Les deploy hooks ne sont volontairement PAS testes ici: le seul moyen de les
// verifier est de declencher un vrai deploiement sur les 10 sites.
if (process.argv.includes('--live') && cron && errors === 0) {
  console.log('\nTest reel des tokens (aucune valeur affichee)')
  let bad = 0
  for (const site of sites) {
    const token = (cron[site.id] ?? '').trim()
    if (!token) continue
    const url = `https://${site.domain}/api/push-send`
    try {
      const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } })
      const body = (await res.text()).slice(0, 200)
      if (res.status === 200) {
        console.log(`  ok    ${site.id.padEnd(13)} ${body}`)
      } else {
        console.log(`  ECHEC ${site.id.padEnd(13)} HTTP ${res.status} ${body}`)
        bad++
      }
    } catch (e) {
      console.log(`  ECHEC ${site.id.padEnd(13)} injoignable (${e.message})`)
      bad++
    }
  }
  console.log(bad ? `\n${bad} token(s) a corriger.` : '\nLes 10 tokens sont acceptes par les sites.')
  process.exit(bad ? 1 : 0)
}

if (errors === 0) {
  console.log('Forme correcte. Relancer avec --live pour tester les tokens contre les vrais sites.')
}
process.exit(errors ? 1 : 0)
