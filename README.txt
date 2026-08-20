TBK V125 - Correctif session/profil inscriptions

Contenu : site complet V124 actualisé en V125, plus scripts SQL de diagnostic et réparation.

Correctifs :
- une erreur de profil ne supprime plus la session Supabase ;
- seul un véritable SIGNED_OUT ramène à l'authentification ;
- les pages restent dans un état connecté et affichent un diagnostic explicite ;
- les sauvegardes d'inscriptions vérifient proprement la présence d'une session ;
- script SQL pour rattacher/réactiver le profil administrateur et restaurer ses droits.

Installation :
1. Ouvrir sql/01_repair_admin_profile.sql.
2. Remplacer REMPLACER_PAR_EMAIL_ADMIN par l'email du compte dans Supabase Authentication > Users.
3. Exécuter le script dans Supabase SQL Editor.
4. Déployer les fichiers du dossier à la racine du site.
5. Se déconnecter puis se reconnecter.

Important : le script ne crée pas un utilisateur Auth. Il rattache un utilisateur Auth existant au profil administrateur.
