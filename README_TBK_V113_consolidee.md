# TBK V113 - Version consolidée finale

Cette version consolide les derniers correctifs du site TBK et ajoute un reset tournoi complet et sécurisé.

## Contenu

- `tbk-v113-final-consolidation.js`
- `TBK_V113_reset_tournoi_complet_rpc.sql`
- `INTEGRATION_INDEX_V113.txt`

## Fonctionnalités couvertes

- Reset tournoi réservé à l'administrateur.
- Export SQL complet avant suppression.
- Suppression de toutes les données tournoi, y compris matchs, scores, planning, équipes, participants et émargements.
- Recréation d'une structure minimale propre : DM, DH, poules, équipes vides, joueurs vides, émargements vides, terrains.
- Aucun match et aucun score après reset.
- Pause temporaire du temps réel et des autosaves pendant l'opération de masse.
- Compatibilité avec l'ancien nom RPC `tbk_rpc_reset_tournament_full`.

## Installation Supabase

Exécuter dans Supabase SQL Editor :

```sql
-- contenu de TBK_V113_reset_tournoi_complet_rpc.sql
```

Puis attendre quelques secondes pour le rechargement du cache PostgREST.

## Installation site

Ajouter à la racine du site :

```text
tbk-v113-final-consolidation.js
```

Puis ajouter tout à la fin de `index.html`, juste avant `</body>` :

```html
<script src="./tbk-v113-final-consolidation.js"></script>
```

## Vérification navigateur

Dans la console :

```javascript
tbkV113Status()
```

## Vérification SQL après reset

```sql
select c.competition_key, count(distinct t.id) as teams, count(distinct p.id) as players
from tournament_competitions c
left join tournament_teams t on t.competition_id = c.id
left join tournament_team_players p on p.team_id = t.id
group by c.competition_key;

select count(*) as matches from tournament_matches;
select count(*) as sets from tournament_match_sets;
```

Résultat attendu après reset :

- DM : 32 équipes, 64 joueurs vides
- DH : 16 équipes, 32 joueurs vides
- 0 match
- 0 score
