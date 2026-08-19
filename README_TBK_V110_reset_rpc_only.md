
# TBK V110 - Reset tournoi côté RPC uniquement

## Objectif

Cette version déplace la logique sensible de reset tournoi côté Supabase/PostgreSQL.
Le navigateur ne supprime plus directement les tables tournoi. Il appelle une seule fonction RPC :

```text
tbk_rpc_reset_tournament_full
```

Cette fonction réalise côté base :

1. export SQL complet des données du tournoi ;
2. suppression ordonnée des données tournoi ;
3. recréation de la structure minimale ;
4. audit ;
5. retour du fichier SQL d'export au navigateur.

## Fichiers

- `TBK_V110_functions_reset_rpc_only.sql`
- `tbk-v110-reset-tournoi-rpc-only.js`
- `README_TBK_V110_reset_rpc_only.md`

## Installation SQL

Dans Supabase SQL Editor, exécuter :

```text
TBK_V110_functions_reset_rpc_only.sql
```

Le script crée :

- `app_locks`
- `tbk_rpc_export_tournament_sql`
- `tbk_rpc_recreate_tournament_minimal_structure`
- `tbk_rpc_reset_tournament_full`
- `tbk_try_audit`

## Installation site

Ajouter `tbk-v110-reset-tournoi-rpc-only.js` à la racine du site.

Dans `index.html`, charger le script tout à la fin, après V108/V109 :

```html
<script src="./tbk-v110-reset-tournoi-rpc-only.js"></script>
```

## Utilisation

Le bouton `♻️ Réinit tournoi` est visible uniquement pour l'administrateur.

Il demande deux confirmations, appelle la RPC, télécharge le SQL d'export, recharge la structure minimale puis relance le temps réel après une pause.

## Commandes console utiles

```javascript
tbkV110ResetStatus()
tbkV110EnsureResetButton()
tbkV110ResetTournamentRpcOnly()
```

## Test SQL de présence de la fonction

```sql
select
  n.nspname,
  p.proname,
  pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname like 'tbk_rpc_%reset%';
```
