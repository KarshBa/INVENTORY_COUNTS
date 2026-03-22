// server.js – complete working file with DATA_DIR env support

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "csv-parse/sync";
import basicAuth from "express-basic-auth";
import fetch     from "node-fetch";
import cors from "cors";

const adminAuth = basicAuth({
  users: {
    [process.env.ADMIN_USER  || 'admin'] : process.env.ADMIN_PASS  || 'changeme',
    [process.env.USER1_USER  || 'user1'] : process.env.USER1_PASS  || 'changeme1',
    [process.env.USER2_USER  || 'user2'] : process.env.USER2_PASS  || 'changeme2',
  },
  challenge: true // browser pops the login dialog
});

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

//----------------------------------------------------
// Persistency: mount your Render disk at /var/data and
// add env var DATA_DIR=/var/data – or leave unset to
// fall back to ./data inside the repo.
//----------------------------------------------------
const DATA_DIR      = process.env.DATA_DIR || path.join(__dirname, "data");
const LISTS_FILE    = path.join(DATA_DIR, "lists_data.json");
const ITEM_CSV_PATH = path.join(__dirname, "item_list.csv");

// ───────────────────────────────
// Remote master list (ITEM_LIST_HANDLER)
// Set env var ITEM_CSV_URL="https://…/item_list.csv"
// ───────────────────────────────
const ITEM_CSV_URL = process.env.ITEM_CSV_URL;
let   refreshTimer = null;   // prevent double scheduling on hot-reload

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(LISTS_FILE)) fs.writeFileSync(LISTS_FILE, "{}", "utf8");

const SIMPLE_FILE = path.join(DATA_DIR, "simple_lists.json");
if (!fs.existsSync(SIMPLE_FILE)) fs.writeFileSync(SIMPLE_FILE,"{}", "utf8");

/***************  load master item list  ***************/
// normalise headers from your CSV export
const clean = s => String(s||"").replace(/\"/g, "").trim().toLowerCase();
const wanted = {
  code : ["main code"],
  brand: ["main item-brand"],
  description: ["main item-description"],
  price: ["price-regular-price"],
  subdept: ["sub-department-number"]    // column AS in your CSV
};
function pick(row, aliases){
  for(const a of aliases){
    const k = Object.keys(row).find(key=>clean(key)===a);
    if(k) return row[k];
  }
  return undefined;
}

// --- helper: canonicalise any scanner payload ----------------------------
//  • EAN-13 / internal catalogue → keep all 13 digits
//  • UPC-A  (12 digits)          → drop *only* the check digit
//  • Scale label stripped (11 d) → 00 + PLU + 0000  → 13 digits
// -------------------------------------------------------------------------
const normalizeUPC = raw => {
  let d = String(raw).replace(/\D/g, "");
  if (!d) return "";

  // 11-digit variable-weight (scanner already removed check digit)
  if (d.length === 11 && d[0] === "2") {
    return ("00" + d.slice(0, 7) + "0000").padStart(13, "0");
  }

  // UPC-A 12 digits → remove *one* check digit → 11 significant
  if (d.length === 12) d = d.slice(0, 11);

  // everything else (already 13 digits) → leave intact
  return d.padStart(13, "0");
};

/* ---------- variable-weight (scale-label) decoder -------------
 * Accepts **both** 11-digit (check-digit already stripped by the scanner)
 * and 12-digit UPC-A labels that begin with “2”.
 *
 * Format  (payload = upc minus optional check digit)
 *   2 + 5-digit PLU + 5-digit price/weight
 *   e.g. 27088050707      → PLU 70880,  price 7.07
 *         270880507071    → same, with check digit ‘1’ on the end
 *
 * The first 7 (or 6) digits become an EAN-13 “catalogue” code:
 *     00 + <7-digits> + 0000   → 13 digits  (used in item_list.csv)
 * --------------------------------------------------------------*/
const decodeScale = upc => {
  // must be 11 **or** 12 digits and start with “2”
  if (!/^\d{11,12}$/.test(upc) || upc[0] !== '2') return null;

  // 12-digit label → throw away check digit; 11-digit is already stripped
  const payload = upc.length === 12 ? upc.slice(0, -1) : upc;

  const cents = parseInt(payload.slice(7, 11), 10);   // last-4 → price/100
  const price = cents / 100;

  const cat = p => ('00' + p).padEnd(13, '0');        // helper → 13-digit code
  return {
    price,
    catCodes: [
      cat(payload.slice(0, 7)),   // 7-digit PLU variant  (preferred)
      cat(payload.slice(0, 6))    // 6-digit PLU variant  (fallback)
    ]
  };
};

function parseMasterCSV(csvText){
  const rows = parse(csvText, { columns:true, skip_empty_lines:true });
  const map  = new Map();
  rows.forEach(r=>{
    const code = normalizeUPC(pick(r, wanted.code));
    if(!code) return;
    map.set(code,{
      code,
      brand      : pick(r, wanted.brand)       || "",
      description: pick(r, wanted.description) || "",
      price      : parseFloat(pick(r, wanted.price)||0) || "",
      subdept    : pick(r, wanted.subdept)     || ""
    });
  });
  return map;
}

export async function refreshItemList (source = 'auto') {   // 'auto' | 'manual'
  if(!ITEM_CSV_URL) return;                   // nothing configured
  try{
    const res = await fetch(ITEM_CSV_URL, { timeout: 15_000 });
    if(!res.ok) throw new Error(`${res.status} ${res.statusText}`);

    const csvText = await res.text();

    // 1️⃣ replace file atomically
    fs.writeFileSync(`${ITEM_CSV_PATH}.tmp`, csvText);
    fs.renameSync   (`${ITEM_CSV_PATH}.tmp`, ITEM_CSV_PATH);

    // 2️⃣ rebuild the in-memory map
    masterItems = parseMasterCSV(csvText);

    const tag = source === 'manual' ? 'Manual-refresh' : 'Auto-refresh';
    console.log(`[${tag}] downloaded ${masterItems.size.toLocaleString()} items @`,
                new Date().toISOString());
  }catch(err){
    console.warn(`[${tag}] failed – keeping existing list:`, err.message);
  }
}

// First run immediately, then every 60 min
if(!refreshTimer){
  refreshItemList();
  refreshTimer = setInterval(refreshItemList, 60*60*1000);
}

let masterItems = new Map();
try{
  const csv = fs.readFileSync(ITEM_CSV_PATH,"utf8");
  masterItems = parseMasterCSV(csv);
  console.log(`[Startup] loaded ${masterItems.size} master items.`);
}catch(err){
  console.error("CSV load failed",err);
}

/***************** helpers for lists ******************/
const fileFor = type => type==="slists" ? SIMPLE_FILE : LISTS_FILE;

const loadLists = (type="lists") =>
  JSON.parse(fs.readFileSync(fileFor(type),"utf8"));

const saveLists = (obj,type="lists") =>
  fs.writeFileSync(fileFor(type), JSON.stringify(obj,null,2));

const normalizeListSafeName = name =>
  String(name || '')
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

function makeUniqueSafeName(displayName, lists) {
  const base = normalizeListSafeName(displayName) || 'list';
  let safeName = base;
  let i = 2;
  while (lists[safeName]) {
    safeName = `${base}-${i++}`;
  }
  return safeName;
}

function getListOr404(lists, safeName, res) {
  const list = lists[safeName];
  if (!list) {
    res.status(404).json({ error: "Not found" });
    return null;
  }
  return list;
}

/********************* Express ***********************/
const app = express();

/* 1️⃣  allow cross‑origin calls BEFORE any routes/static */
app.use(
  cors({
    origin: '*',                         // or an array of allowed origins
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  })
);

/* 2️⃣  body‑parser */
app.use(express.json());

/* 3️⃣  protect ONLY the admin page & its API */
app.use('/admin.html', adminAuth);
app.use('/api/admin',  adminAuth);

/* 4️⃣  static assets */
app.use(express.static(path.join(__dirname, 'public')));

/*********** API ***********/
app.get("/api/items",(_,res)=>res.json(Object.fromEntries(masterItems)));

/* -------------------------------------------------------
 *  /api/open-scale-plu?count=N
 *  Returns the first N unassigned 4-digit PLUs (1111-9999)
 * ------------------------------------------------------*/
app.get('/api/open-scale-plu', async (req, res) => {
  const want = Math.max(1, Math.min(100, parseInt(req.query.count||1,10)));
  const taken = new Set();

 // ── tolerant lookup: collapse header to A‑Z0‑9 before comparing ──
  const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g,'');
  try {
    const csv = fs.readFileSync(ITEM_CSV_PATH,'utf8');
    parse(csv,{columns:true,skip_empty_lines:true}).forEach(r=>{
      const key  = Object.keys(r).find(k => norm(k)==='posinformationplucode');
      if(!key) return;                                // column not present
      const raw  = String(r[key]).trim();             // e.g. 205 or "0205 "
      const code = String(parseInt(raw,10)).padStart(4,'0'); // → "0205"
      if(/^\d{4}$/.test(code)) taken.add(code);
    });
  } catch(err){
    return res.status(500).json({error:err.message});
  }

  /* find the first N free numbers starting from 1111 */
  const free = [];
  for(let p=1111; p<=9999 && free.length<want; p++){
    const s = String(p);
    if(!taken.has(s)) free.push(s);
  }
  res.json({ free });
});

/* ────────────────────────────────
   Called by ITEM_LIST_HANDLER after
   you press “Upload” or “Refresh”.
   It just pulls the fresh CSV.
   ────────────────────────────────*/
app.post("/api/refresh-items", async (_req, res) => {
  try {
    await refreshItemList('manual');
    res.sendStatus(204);       // 204 No Content
  } catch (err) {
    console.error("[Refresh] failed", err);
    res.status(500).json({ error: err.message });
  }
});

/* ---------- simple-lists (“slists”) ---------- */
app.get('/api/slists',            (_,res)=>res.json(loadLists('slists')));
app.post('/api/slists',           (req,res)=>addList('slists',req,res));
app.get('/api/slists/exportall',  (_,res)=>exportAll('slists',res));
app.get('/api/slists/export/:name',(req,res)=>exportOne('slists',req,res));
app.get('/api/slists/:name',      (req,res)=>res.json(getList('slists',req,res)));
app.post('/api/slists/:name/items',(req,res)=>addItem('slists',req,res,false));
app.delete('/api/slists/:name/items/:code',(req,res)=>delItem('slists',req,res));
app.delete('/api/slists/:name',   (req,res)=>delList('slists',req,res));

// ────────────────────────────────────────────────────────────────
// 1) NEW SINGLE-ITEM LOOK-UP  (drop it right after `app.get("/api/items" …)`
// ────────────────────────────────────────────────────────────────
app.get("/api/item/:code", (req, res) => {
  const raw   = String(req.params.code||"").replace(/\D/g,"");
  // ➊ normal catalogue code ------------------------------------
  let code13  = normalizeUPC(raw);
  let hit     = masterItems.get(code13);

  // ➋ variable-weight (scale) label ----------------------------
  if(!hit){
    const s = decodeScale(raw);
    if(s){
      const cat  = s.catCodes.find(c => masterItems.has(c));
      hit = cat ? { ...masterItems.get(cat), price: s.price }
                : { code: s.catCodes[0],    price: s.price };   // fallback
    }
  }

  res.json(hit || {});        // {} = “not found”
});

// generic helpers for both list systems
function addList(type, req, res){
  const { name } = req.body || {};
  const displayName = String(name || '').trim();
  if (!displayName) return res.status(400).json({ error:"Missing name" });

  const lists = loadLists(type);
  const duplicateDisplay = Object.values(lists).some(
    list => (list.displayName || '').trim().toLowerCase() === displayName.toLowerCase()
  );
  if (duplicateDisplay) return res.status(409).json({ error:"Exists" });

  const safeName = makeUniqueSafeName(displayName, lists);
  lists[safeName] = {
    displayName,
    safeName,
    items: {},
    created: Date.now()
  };

  saveLists(lists, type);
  res.status(201).json({ message:"created", safeName, displayName });
}

function getList(type, req, res){
  const safeName = decodeURIComponent(req.params.name || '');
  const list = loadLists(type)[safeName];
  if(!list) return res.status(404).json({error:"Not found"});
  return list;
}

function addItem(type, req, res, merge=true){
  const { code } = req.body||{};
  if(!code) return res.status(400).json({error:"Missing code"});
  const lists = loadLists(type);
  const safeName = decodeURIComponent(req.params.name || '');
  const list = lists[safeName];
  if(!list) return res.status(404).json({error:"List missing"});
  if(merge) list.items[code]=masterItems.get(code)||{code};
  else list.items[Date.now()]=masterItems.get(code)||{code};
  saveLists(lists,type);
  res.json({message:"added"});
}

function delItem(type, req, res){
  const lists = loadLists(type);
  const safeName = decodeURIComponent(req.params.name || '');
  const list = lists[safeName];
  if(list){ delete list.items[req.params.code]; saveLists(lists,type); }
  res.json({message:"deleted"});
}

function delList(type, req, res){
  const lists = loadLists(type);
  const safeName = decodeURIComponent(req.params.name || '');
  delete lists[safeName];
  saveLists(lists,type);
  res.json({message:"deleted"});
}

function exportOne(type, req, res){
  const safeName = decodeURIComponent(req.params.name || '');
  const list = loadLists(type)[safeName];
  if(!list) return res.status(404).json({error:"Not found"});

  const rows=[["Item Code","Brand","Description","Price","Sub-Dept"]];
  Object.values(list.items).forEach(it=>{
    const m = masterItems.get(it.code)||it;
    rows.push([
       it.code,
       m.brand,
       m.description,
       m.price ?? "",
       m.subdept || ""
     ]);
  });

  const filenameBase = (list.displayName || safeName).replace(/[^\w.-]+/g, '_');
  res.setHeader("Content-Type","text/csv");
  res.setHeader("Content-Disposition",`attachment; filename=${filenameBase}.csv`);
  res.send(rows.map(r=>r.join(",")).join("\n"));
}

function exportAll(type, res){
  const lists=loadLists(type);
  const rows=[["List","Item Code","Brand","Description","Price","Sub-Dept"]];
  Object.entries(lists).forEach(([n,l])=>{
    Object.values(l.items).forEach(it=>{
      const m = masterItems.get(it.code)||it;
      rows.push([
         n,
         it.code,
         m.brand,
         m.description,
         m.price ?? "",
         m.subdept || ""
       ]);
    });
  });
  res.setHeader("Content-Type","text/csv");
  res.setHeader("Content-Disposition","attachment; filename=all_simple_lists.csv");
  res.send(rows.map(r=>r.join(",")).join("\n"));
}

app.get("/api/lists",(_,res)=>res.json(loadLists()));

app.post("/api/lists",(req,res)=>{
  const { name } = req.body || {};
  const displayName = String(name || '').trim();
  if(!displayName) return res.status(400).json({error:"Missing name"});

  const lists = loadLists();
  const duplicateDisplay = Object.values(lists).some(
    list => (list.displayName || '').trim().toLowerCase() === displayName.toLowerCase()
  );
  if (duplicateDisplay) return res.status(409).json({error:"Exists"});

  const safeName = makeUniqueSafeName(displayName, lists);
  lists[safeName] = {
    displayName,
    safeName,
    items: {},
    created: Date.now()
  };

  saveLists(lists);
  res.status(201).json({message:"created", safeName, displayName});
});

app.get("/api/lists/:name",(req,res)=>{
  const safeName = decodeURIComponent(req.params.name || '');
  const list = loadLists()[safeName];
  if(!list) return res.status(404).json({error:"Not found"});
  res.json(list);
});

app.post("/api/lists/:name/items",(req,res)=>{
  // pull from body, then canonicalise
  let { itemCode, brand, description, price, delta } = req.body;
const raw = String(itemCode||'').replace(/\D/g,'');
  
let scale = decodeScale(raw);                 // 🆕 check for scale label
if (scale) {
  // pick the catalogue code that actually exists in masterItems,
  // otherwise fall back to the first (7-digit) candidate
  itemCode = scale.catCodes.find(c => masterItems.has(c)) || scale.catCodes[0];
  price    = scale.price;                     // price comes from the label!
} else {
  itemCode = normalizeUPC(raw);               // normal barcode path
}

if(!itemCode) return res.status(400).json({error:"Missing code"});
  const lists = loadLists();
  const safeName = decodeURIComponent(req.params.name || '');
  const list = lists[safeName];
  if(!list) return res.status(404).json({error:"List missing"});
  // ------------------------------------------------------------------
  //  VARIABLE-WEIGHT ITEMS: make *every sticker* its own row so each
  //  keeps its price.  We add price-cents + a time-stamp to the key.
  // ------------------------------------------------------------------
  const isScale = !!scale;                      // after the call above
  let   key     = itemCode;                     // default merge key
  if (isScale) {
    const cents = Math.round(parseFloat(price) * 100);
    key = `${itemCode}-${String(cents).padStart(4,"0")}-${Date.now().toString(36)}`;
  }

  const master = masterItems.get(itemCode);
  let entry = list.items[key] || {
    code: itemCode,
    brand: master?.brand || brand || "",
    description: master?.description || description || "",
    price: (price !== undefined && price !== "" )
             ? parseFloat(price)            // <-- keep sticker price when given
             : (master ? master.price : 0),
    qty: 0
};
    if(master){
    entry.brand = master.brand;
    entry.description = master.description;
    // keep sticker price for scale labels – only overwrite when none sent
    if(price===undefined || price==="") entry.price = master.price;
  }else{
    if(brand&&brand.trim()) entry.brand=brand.trim();
    if(description&&description.trim()) entry.description=description.trim();
    if(price!==undefined&&price!=="") entry.price=parseFloat(price);
  }
  entry.qty += parseFloat(delta)||0;
  if(entry.qty===0) delete list.items[key];
  else list.items[key]=entry;
  saveLists(lists);
  res.json({message:"updated",item:entry});
});

app.delete("/api/lists/:name",(req,res)=>{
  const lists = loadLists();
  const safeName = decodeURIComponent(req.params.name || '');
  delete lists[safeName];
  saveLists(lists);
  res.json({message:"deleted"});
});

app.delete("/api/lists",(_,res)=>{saveLists({});res.json({message:"all cleared"});});

app.get("/api/export/:name", (req, res) => {
  const safeName = decodeURIComponent(req.params.name || '');
  const base = c => c.split('-')[0];
  const list = loadLists()[safeName];
  if (!list) return res.status(404).json({ error: "List not found" });

  // Header now includes Sub-department
  const rows = [["Item Code","Brand","Sub-department","Description","Price","Quantity","Total"]];
  let grand = 0;

  Object.values(list.items).forEach(it => {
    const t = it.qty * it.price;
    grand += t;
    // Look up subdept from masterItems (loaded from CSV column AS)
    const subdept = masterItems.get(base(it.code))?.subdept || "";
    rows.push([
      it.code,
      it.brand,
      subdept,
      it.description,
      it.price,
      it.qty,
      t
    ]);
  });

  rows.push(["","","","","","List Total",grand]);

  const filenameBase = (list.displayName || safeName).replace(/[^\w.-]+/g, '_');
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename=${filenameBase}.csv`);
  res.send(rows.map(r => r.join(",")).join("\r\n"));
});

app.get("/api/exportall", (_, res) => {
  const base = c => c.split('-')[0];
  const lists = loadLists();
  // Include Sub-department in the header
  const rows = [["List","Item Code","Brand","Sub-department","Description","Price","Qty","Total"]];
  let grand = 0;
  
  Object.entries(lists).forEach(([listName, list]) => {
    Object.values(list.items).forEach(it => {
      const t = it.qty * it.price;
      grand += t;
      const subdept = masterItems.get(base(it.code))?.subdept || "";
        rows.push([
        list.displayName || listName,
        it.code,
        it.brand,
        subdept,
        it.description,
        it.price,
        it.qty,
        it.qty * it.price
      ]);
    });
  });
  
  rows.push(["","","","","","","List Total",grand]);

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=all_lists.csv");
  res.send(rows.map(r => r.join(",")).join("\r\n"));
});

/******************** start ********************/
const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log(`Inventory Counts App listening on port ${PORT}`));
