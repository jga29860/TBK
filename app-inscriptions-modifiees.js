/*
Patch TBK V126
A intégrer dans app.js :
- Table id=registrations-table
- Container scrollable
- Colonnes redimensionnables

Remplacements principaux :

<table>
=>
<div class="inscriptions-container">
<table id="registrations-table" class="tbk-table">

</table>
=>
</table></div>

<th>${esc(c.label)}</th>
=>
<th data-column-key="${esc(c.column_key)}" style="min-width:220px">
${esc(c.label)}
</th>

Puis après génération du tableau :
if(window.TBK_RESIZE){
  TBK_RESIZE.enableResize(document.getElementById('registrations-table'));
}
*/
