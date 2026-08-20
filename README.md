# TBK Diagnostic V115

## Contenu

- `registrations.js` : gestion de session et d’erreurs renforcée pour les inscriptions.
- `admin.js` : contrôle de session, journalisation et seconde tentative pour l’Edge Function.
- `test-session.js` : diagnostic de la session courante.
- `test-edge-function.js` : test de l’Edge Function `tbk-admin-users` avec l’action `ping`.
- `page-test.html` : interface de diagnostic.
- `controle-supabase.sql` : requêtes de contrôle en lecture seule pour les tables, colonnes et politiques RLS.

## Installation

1. Sauvegarder les fichiers actuels `registrations.js` et `admin.js`.
2. Remplacer ces deux fichiers par les versions du ZIP.
3. Copier les deux scripts de test et `page-test.html` dans un emplacement réservé aux administrateurs.
4. Dans `page-test.html`, charger avant les scripts de diagnostic les scripts habituels qui initialisent `TBK_DB` et `TBK_AUTH`.
5. Effectuer un rechargement forcé du navigateur avec `Ctrl + F5`.

## Tests

1. Tester la création et la modification d’une inscription.
2. Vérifier qu’aucune déconnexion brutale ne se produit.
3. Ouvrir la page de diagnostic et tester la session.
4. Tester l’Edge Function avec un compte administrateur.
5. Examiner la console navigateur pour les préfixes `[TBK_REG]`, `[TBK_ADMIN]`, `[TBK_TEST_SESSION]` et `[TBK_TEST_EDGE]`.

## Attention sur l’action ping

Le test Edge Function envoie `{ "action": "ping" }`. La fonction `tbk-admin-users` doit accepter cette action et répondre par exemple avec `{ "success": true }`. Si l’action n’existe pas, le test confirmera que la fonction est joignable mais affichera son erreur métier. Ajouter côté Edge Function un cas `ping` sans opération sur les données si nécessaire.

## Sécurité

- Restreindre l’accès à `page-test.html` aux administrateurs.
- Ne jamais afficher ni journaliser la valeur de `access_token`.
- Le script SQL fourni effectue uniquement des lectures.
- Tester d’abord dans un environnement de recette ou après sauvegarde.
