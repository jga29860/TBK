# TBK V108 - Reset tournoi optimisé, anti-tempête Supabase

## Problème corrigé

Après la réinitialisation du tournoi, un grand nombre de requêtes était envoyé vers Supabase.

## Cause identifiée

La V107 supprimait puis recréait beaucoup de lignes dans les tables tournoi. Le temps réel V94 était encore actif ou relancé trop vite, donc chaque suppression/insertion pouvait déclencher des événements Supabase, puis des rechargements `loadTournamentRelationalV91`, `loadTournamentScoresRelationalV92`, `loadTournamentPlanningRelationalV93` et des rendus.

## Corrections V108

La V108 ajoute trois garde-fous :

1. **Pause temps réel pendant le reset**
   - arrêt de `stopRealtimeV94()` avant suppression/recréation ;
   - blocage des redémarrages automatiques pendant la fenêtre de reset ;
   - redémarrage différé après stabilisation.

2. **Neutralisation des sauvegardes automatiques relationnelles**
   - `renderAll()` est forcé en mode `skipSave=true` pendant le reset ;
   - `saveTournamentRelationalV91()` ignore les appels automatiques pendant le reset.

3. **Filtrage des événements temps réel**
   - le module V94 ignore les événements reçus pendant la période de pause.

## Fichiers modifiés / ajoutés

```text
tbk-v94-realtime-sync.js
tbk-v107-admin-reset-tournament.js
tbk-v108-reset-storm-guard.js
TBK_V108_index_reset_tournoi_optimise.html
```

## Diagnostic navigateur

Dans la console :

```javascript
tbkV108ResetStormStatus()
```

## Déploiement

Déposer le contenu du ZIP à la racine GitHub Pages puis utiliser :

```text
index.html
```

Le fichier index est déjà présent dans le ZIP.
