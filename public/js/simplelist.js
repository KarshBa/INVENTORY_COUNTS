// simplelist.js – zero‑qty, scan‑only lists
const $ = s => document.querySelector(s);
const listSel   = $('#listSelect');
const newList   = $('#newList');
const createBtn = $('#createBtn');
const scanIn    = $('#scan');
const warnMsg   = $('#warn');
const tbody     = $('#shrink-table tbody');
const exportBtn = $('#exportBtn');
const exportAll = $('#exportAllBtn');
const delListBtn= $('#delListBtn');

let master={};
let current="";

(async()=>{
  master = await (await fetch('/api/items')).json();
  await refreshLists();
})();

async function refreshLists(){
  const lists = await (await fetch('/api/slists')).json();
  listSel.innerHTML = Object.keys(lists).map(n=>`<option>${n}</option>`).join('');
  if(!current && Object.keys(lists).length) current = Object.keys(lists)[0];
  if(current) listSel.value=current;
  render();
}

createBtn.onclick = async () => {
  const name = (newList.value||listSel.value).trim();
  if(!name) return;
  const res = await fetch('/api/slists',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});
  if(res.ok) { current=name; newList.value=''; await refreshLists(); }
};

listSel.onchange = () => { current=listSel.value; render(); };

scanIn.onkeydown = async e => {
  if(e.key!=='Enter') return;
  const code = normalizeUPC(scanIn.value);
  scanIn.value='';
  if(!code) return;
  const exists = master[code];
  if(!exists){ warnMsg.classList.remove('hidden'); return; }
  warnMsg.classList.add('hidden');
  await fetch(`/api/slists/${encodeURIComponent(current)}/items`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});
  render();
};

delListBtn.onclick = async ()=>{
  if(!current) return;
  if(!confirm(`Delete list “${current}”?`)) return;
  await fetch(`/api/slists/${encodeURIComponent(current)}`,{method:'DELETE'});
  current=""; await refreshLists();
};

exportBtn.onclick = ()=>{ if(current) window.location = `/api/slists/export/${encodeURIComponent(current)}`; };
exportAll.onclick = ()=>{ window.location = '/api/slists/exportall'; };

tbody.onclick = async e => {
  if(!e.target.matches('button.del')) return;
  const row = e.target.closest('tr');
  const code = row.dataset.code;
  await fetch(`/api/slists/${encodeURIComponent(current)}/items/${code}`,{method:'DELETE'});
  render();
};

async function render(){
  if(!current) { tbody.innerHTML=''; return; }
  const list = await (await fetch(`/api/slists/${encodeURIComponent(current)}`)).json();
  const rows = Object.values(list.items);
  // mobile: keep last 10 rows
  const trimmed = window.innerWidth<=600 ? rows.slice(-10) : rows;
  tbody.innerHTML = trimmed.map(it=>`<tr data-code="${it.code}">
     <td class="code">${it.code}</td>
     <td class="brand">${it.brand}</td>
     <td class="description">${it.description}</td>
     <td>${it.subdept||''}</td>
     <td class="del-col"><button class="del">✕</button></td>
  </tr>`).join('');
}

function normalizeUPC(raw){
  let d=String(raw).replace(/\D/g,'');
  if(!d) return ''; if(d.length===13) d=d.slice(0,12); else if(d.length===12) d=d.slice(0,11);
  return d.padStart(13,'0');
}