// Parse official GLD holdings archive XLSX entirely in memory. Never redistribute source rows.
const zlib=require('node:zlib');
const mon={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
function unzipSelected(bytes,names){
 const b=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes),wanted=new Set(names),found={};
 let eocd=-1;for(let p=b.length-22;p>=Math.max(0,b.length-66000);p--){if(b.readUInt32LE(p)===0x06054b50){eocd=p;break}}
 if(eocd<0)throw Error('GLD archive ZIP end record missing');
 const entries=b.readUInt16LE(eocd+10);let p=b.readUInt32LE(eocd+16);
 for(let i=0;i<entries;i++){
  if(p+46>b.length||b.readUInt32LE(p)!==0x02014b50)throw Error('Invalid ZIP directory');
  const method=b.readUInt16LE(p+10),compressed=b.readUInt32LE(p+20),plain=b.readUInt32LE(p+24),n=b.readUInt16LE(p+28),extra=b.readUInt16LE(p+30),comment=b.readUInt16LE(p+32),local=b.readUInt32LE(p+42);
  const name=b.subarray(p+46,p+46+n).toString('utf8');
  if(wanted.has(name)){
   if(local+30>b.length||b.readUInt32LE(local)!==0x04034b50)throw Error('ZIP local header mismatch');
   const pos=local+30+b.readUInt16LE(local+26)+b.readUInt16LE(local+28);
   if(pos+compressed>b.length||plain>30*1024*1024)throw Error('Invalid XLSX member size');
   const raw=b.subarray(pos,pos+compressed);
   const value=method===8?zlib.inflateRawSync(raw):method===0?raw:null;
   if(!value||value.length!==plain)throw Error('Unsupported ZIP compression or invalid size');
   found[name]=value.toString('utf8');
  }
  p+=46+n+extra+comment;
 }
 if(!found['xl/worksheets/sheet2.xml'])throw Error('GLD historic sheet2.xml missing');
 return found;
}
const decode=x=>String(x).replace(/&(?:amp|lt|gt|quot|apos|#x[0-9a-f]+|#\d+);/gi,m=>m==='&amp;'?'&':m==='&lt;'?'<':m==='&gt;'?'>':m==='&quot;'?'"':m==='&apos;'?"'":m.toLowerCase().startsWith('&#x')?String.fromCodePoint(parseInt(m.slice(3,-1),16)):String.fromCodePoint(parseInt(m.slice(2,-1),10)));
function sharedStrings(xml){
 if(!xml)return [];
 const strings=[];for(const match of xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)){
  strings.push([...match[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(x=>decode(x[1])).join(''));
 }
 return strings;
}
function parseDate(s){
 const m=String(s||'').trim().match(/^(\d{1,2})-([A-Za-z]{3})-(20\d\d|19\d\d)$/);
 if(!m)return null;
 const month=mon[m[2].toLowerCase()],day=+m[1],year=+m[3];
 if(!month||day<1||day>31)return null;
 const iso=String(year)+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0');
 const d=new Date(iso+'T00:00:00Z');return Number.isFinite(d.valueOf())&&d.getUTCDate()===day?iso:null;
}
function parseXlsx(binary){
 const files=unzipSelected(binary,['xl/sharedStrings.xml','xl/worksheets/sheet2.xml']),strings=sharedStrings(files['xl/sharedStrings.xml']),xml=files['xl/worksheets/sheet2.xml'];
 let headers={},dated=0,valid=0,missingTonnes=0;const pairs=[];
 for(const row of xml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)){
  const values={};
  for(const cell of row[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)){
   const ref=cell[1].match(/\br="([A-Z]+)\d+"/),type=cell[1].match(/\bt="([^"]+)"/);if(!ref)continue;
   const v=cell[2].match(/<v>([\s\S]*?)<\/v>/);
   if(!v)continue;
   const raw=decode(v[1]);values[ref[1]]=type?.[1]==='s'?strings[Number(raw)]:raw;
  }
  if(!Object.keys(headers).length){
   for(const [key,value] of Object.entries(values)){
    if(String(value).trim().toLowerCase()==='date')headers.date=key;
    if(String(value).trim().toLowerCase().startsWith('tonnes of gold'))headers.tonnes=key;
   }
   if(!headers.date||!headers.tonnes)continue;
   continue;
  }
  const date=parseDate(values[headers.date]);if(!date)continue;dated++;
  const tonne=Number(String(values[headers.tonnes]||'').replace(/,/g,''));
  if(!Number.isFinite(tonne)||tonne<=0){missingTonnes++;continue}
  valid++;pairs.push({date,tonne});
 }
 if(!headers.date||!headers.tonnes)throw Error('GLD Date/Tonnes of Gold header schema absent');
 pairs.sort((a,b)=>a.date.localeCompare(b.date));
 if(new Set(pairs.map(x=>x.date)).size!==pairs.length)throw Error('Duplicate GLD holdings dates');
 const changes=[];
 for(let i=1;i<pairs.length;i++){
  const gap=(Date.parse(pairs[i].date)-Date.parse(pairs[i-1].date))/86400000;
  if(gap>10)continue;
  changes.push({date:pairs[i].date,value:pairs[i].tonne-pairs[i-1].tonne});
 }
 if(changes.filter(x=>x.date.startsWith('2025')).length<200)throw Error('GLD 2025 holdings delta coverage inadequate');
 const annual=Object.fromEntries([2024,2025,2026].map(y=>[y,{change_days:changes.filter(x=>x.date.startsWith(String(y))).length}]));
 return {changes,coverage:{source:'SPDR GLD official XLSX',rows_with_date:dated,rows_with_date_and_tonnes:valid,missing_tonnes_rows:missingTonnes,first_date:pairs[0]?.date,last_date:pairs.at(-1)?.date,annual,holds_gold_tonnes_not_investor_net_flow:true,real_historical_archive_vintage_verified:false}};
}
module.exports={parseXlsx,parseDate,unzipSelected,sharedStrings};
