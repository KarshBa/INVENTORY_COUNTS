// server.js – complete working file with DATA_DIR env support

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "csv-parse/sync";

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

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(LISTS_FILE)) fs.writeFileSync(LISTS_FILE, "{}", "utf8");

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

// --- helper: normalise any scanner payload to 13-digit / no-check-digit ---
const normalizeUPC = raw => {
  let d = String(raw).replace(/\D/g, "");   // keep digits only
  if (!d) return "";

  // 13-digit payload → drop last (check)  → 12 significant
  if (d.length === 13) d = d.slice(0, 12);

  // 12-digit payload → drop last (check)  → 11 significant
  else if (d.length === 12) d = d.slice(0, 11);

  // pad to full 13 with leading zeros
  return d.padStart(13, "0");
};

/* ---------- variable-weight (scale-label) decoder -------------
 * A 12-digit UPC-A that starts with “2”:
 *    2 + 5-digit PLU + 5-digit price/weight + check-digit
 * Example: 270880507071 → PLU 70880  price $7.07
 *
 * We turn the first 7 (or 6) digits into the 13-digit
 * “catalogue” code used in item_list.csv:
 *     00 + <7-digits> + 0000   → 13 digits
 * --------------------------------------------------------------*/
const decodeScale = upc => {
  if (!/^\d{12}$/.test(upc) || upc[0] !== '2') return null;    // not a scale label

  const body   = upc.slice(0, -1);                   // drop check-digit
  const cents  = parseInt(body.slice(7, 11), 10);    // last-4 payload → price
  const price  = cents / 100;

  const cat = p => ('00' + p).padEnd(13, '0');       // helper → 13-digit code
  return {
    price,
    catCodes: [ cat(body.slice(0, 7)),               // 7-digit PLU variant
                cat(body.slice(0, 6)) ]              // 6-digit PLU variant
  };
};

let masterItems = new Map();
try {
  const csv = fs.readFileSync(ITEM_CSV_PATH, "utf8");
  const rec = parse(csv,{columns:true,skip_empty_lines:true});
  rec.forEach(r=>{
    const code = String(pick(r,wanted.code)||"").padStart(13,"0");
    if(!code) return;
    masterItems.set(code,{
      code,
      brand: pick(r,wanted.brand)||"",
      description: pick(r,wanted.description)||"",
      price:        parseFloat(pick(r,wanted.price)||0),
      subdept:      pick(r,wanted.subdept)     || ""    // <— store it here
    });
  });
  console.log(`Loaded ${masterItems.size} master items.`);
}catch(err){ console.error("CSV load failed",err); }

/***************** helpers for lists ******************/
const loadLists = () => JSON.parse(fs.readFileSync(LISTS_FILE,"utf8"));
const saveLists = obj => fs.writeFileSync(LISTS_FILE,JSON.stringify(obj,null,2));

/********************* Express ***********************/
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname,"public")));

/*********** API ***********/
app.get("/api/items",(_,res)=>res.json(Object.fromEntries(masterItems)));

app.get("/api/lists",(_,res)=>res.json(loadLists()));

app.post("/api/lists",(req,res)=>{
  const {name}=req.body;
  if(!name) return res.status(400).json({error:"Missing name"});
  const lists=loadLists();
  if(lists[name]) return res.status(409).json({error:"Exists"});
  lists[name]={items:{},created:Date.now()};
  saveLists(lists);
  res.status(201).json({message:"created"});
});

app.get("/api/lists/:name",(req,res)=>{
  const list=loadLists()[req.params.name];
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
  const lists=loadLists();
  const list=lists[req.params.name];
  if(!list) return res.status(404).json({error:"List missing"});
  const master=masterItems.get(itemCode);
  let entry=list.items[itemCode]||{
    code:itemCode,
    brand:master?.brand||brand||"",
    description:master?.description||description||"",
    price:master?master.price:parseFloat(price||0),
    qty:0
  };
  if(master){
    entry.brand=master.brand;
    entry.description=master.description;
    entry.price=master.price;
  }else{
    if(brand&&brand.trim()) entry.brand=brand.trim();
    if(description&&description.trim()) entry.description=description.trim();
    if(price!==undefined&&price!=="") entry.price=parseFloat(price);
  }
  entry.qty += parseFloat(delta)||0;
  if(entry.qty===0) delete list.items[itemCode];
  else list.items[itemCode]=entry;
  saveLists(lists);
  res.json({message:"updated",item:entry});
});

app.delete("/api/lists/:name",(req,res)=>{
  const lists=loadLists();
  delete lists[req.params.name];
  saveLists(lists);
  res.json({message:"deleted"});
});

app.delete("/api/lists",(_,res)=>{saveLists({});res.json({message:"all cleared"});});

app.get("/api/export/:name", (req, res) => {
  const list = loadLists()[req.params.name];
  if (!list) return res.status(404).json({ error: "List not found" });

  // Header now includes Sub-department
  const rows = [["Item Code","Brand","Sub-department","Description","Price","Quantity","Total"]];
  let grand = 0;

  Object.values(list.items).forEach(it => {
    const t = it.qty * it.price;
    grand += t;
    // Look up subdept from masterItems (loaded from CSV column AS)
    const subdept = masterItems.get(it.code)?.subdept || "";
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

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename=${req.params.name}.csv`);
  res.send(rows.map(r => r.join(",")).join("\n"));
});

app.get("/api/exportall", (_, res) => {
  const lists = loadLists();
  // Include Sub-department in the header
  const rows = [["List","Item Code","Brand","Sub-department","Description","Price","Qty","Total"]];
  let grand = 0;
  
  Object.entries(lists).forEach(([listName, list]) => {
    Object.values(list.items).forEach(it => {
      const t = it.qty * it.price;
      grand += t;
      const subdept = masterItems.get(it.code)?.subdept || "";
      rows.push([
        listName,
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
  res.send(rows.map(r => r.join(",")).join("\n"));
});

/******************** start ********************/
const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log(`Inventory Counts App listening on port ${PORT}`));
