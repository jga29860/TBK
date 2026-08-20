# TBK Inscriptions - Colonnes redimensionnables

Ajouter dans la page inscriptions :

<link rel="stylesheet" href="registrations-resize.css">
<script src="registrations-resize.js"></script>

Après génération du tableau :

TBK_RESIZE.enableResize(document.getElementById('registrations-table'));

Fonctions :
- Colonnes élargies par défaut
- Redimensionnement à la souris
- Double-clic pour réinitialiser
- Sauvegarde des largeurs dans localStorage
- Entêtes fixes
- Défilement horizontal
