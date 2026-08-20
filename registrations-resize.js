(function(){
'use strict';
const STORAGE_KEY='tbk_registration_column_widths';
function loadWidths(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}');}catch(e){return {};}}
function saveWidths(w){localStorage.setItem(STORAGE_KEY,JSON.stringify(w));}
function enableResize(table){
 const widths=loadWidths();
 const headers=table.querySelectorAll('th');
 headers.forEach((th,index)=>{
  const key=th.dataset.columnKey||('col_'+index);
  if(widths[key]) th.style.width=widths[key]+'px';
  const h=document.createElement('div');
  h.className='resize-handle';
  th.appendChild(h);
  let startX,startWidth;
  h.addEventListener('mousedown',e=>{
   startX=e.pageX; startWidth=th.offsetWidth;
   function move(ev){
    const width=Math.max(100,startWidth+(ev.pageX-startX));
    th.style.width=width+'px';
    table.querySelectorAll('tr').forEach(r=>{if(r.children[index]) r.children[index].style.width=width+'px';});
   }
   function up(){widths[key]=th.offsetWidth;saveWidths(widths);document.removeEventListener('mousemove',move);document.removeEventListener('mouseup',up);}
   document.addEventListener('mousemove',move);
   document.addEventListener('mouseup',up);
  });
  h.addEventListener('dblclick',()=>{delete widths[key];saveWidths(widths);th.style.width='';});
 });
}
window.TBK_RESIZE={enableResize};
})();
