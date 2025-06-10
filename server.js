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
  code : ["main code", "item code", "code"],
  brand: ["main item-brand", "brand"],
  description: ["main item-description", "description"],
  price: ["price-regular-price", "price active price", "price", "unit price"],
  subdept: ["sub-department-description"]    // column AS in your CSV
};
function pick(row, aliases){
  for(const a of aliases){
    const k = Object.keys(row).find(key=>clean(key)===a);
    if(k) return row[k];
  }
  return undefined;
}

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
  const {itemCode,brand,description,price,delta}=req.body;
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

  rows.push(["","","","","Grand",grand]);

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename=${req.params.name}.csv`);
  res.send(rows.map(r => r.join(",")).join("\n"));
});

app.get("/api/exportall", (_, res) => {
  const lists = loadLists();
  // Include Sub-department in the header
  const rows = [["List","Item Code","Brand","Sub-department","Description","Price","Qty","Total"]];

  Object.entries(lists).forEach(([listName, list]) => {
    Object.values(list.items).forEach(it => {
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

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=all_lists.csv");
  res.send(rows.map(r => r.join(",")).join("\n"));
});

/******************** start ********************/
const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log(`Inventory Counts App listening on port ${PORT}`));
