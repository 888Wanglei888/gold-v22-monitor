#!/usr/bin/env python3
"""Audit official SPDR GLD historical XLSX without republishing historical holdings."""
import datetime as dt
import io
import json
import os
import re
import urllib.request
import zipfile
from xml.etree import ElementTree as ET

SOURCE='https://api.spdrgoldshares.com/api/v1/historical-archive?exchange=NYSE&lang=en&product=gld'
X='{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'

def inspect(binary):
    with zipfile.ZipFile(io.BytesIO(binary)) as z:
        if z.testzip() is not None:
            raise ValueError('Archive has invalid CRC')
        strings=[]
        if 'xl/sharedStrings.xml' in z.namelist():
            root=ET.fromstring(z.read('xl/sharedStrings.xml'))
            strings=[''.join((t.text or '') for t in si.iter(X+'t')) for si in root.findall(X+'si')]
        files=sorted(x for x in z.namelist() if re.fullmatch(r'xl/worksheets/sheet\d+\.xml',x))
        if not files:
            raise ValueError('No worksheet XML')
        sheets=[]
        for path in files:
            rows=0
            hints=set()
            dates={}
            date_headers=set()
            date_value_formats={}
            masked_date_samples=set()
            with z.open(path) as sheet:
                for _,element in ET.iterparse(sheet,events=('end',)):
                    if element.tag!=X+'row':
                        continue
                    rows+=1
                    for cell in element.findall(X+'c'):
                        mat=re.match(r'([A-Z]+)',cell.attrib.get('r',''))
                        if not mat:
                            continue
                        col=mat.group(1)
                        val=cell.find(X+'v')
                        value=val.text.strip() if val is not None and val.text is not None else ''
                        if not value and cell.find(X+'is') is not None:
                            value=''.join(t.text or '' for t in cell.find(X+'is').iter(X+'t')).strip()
                        if cell.attrib.get('t')=='s' and value.isdecimal() and int(value)<len(strings):
                            value=strings[int(value)]
                        if not value:
                            continue
                        if rows<=20 and value.strip().lower()=='date':
                            date_headers.add(col)
                        if rows<=20 and len(value)<=80 and any(x in value.lower() for x in ('date','tonne','hold','ounce','share')):
                            hints.add(re.sub(r'\s+',' ',value))
                        if col not in ('A','B','C','D'):
                            continue
                        day=None
                        if re.fullmatch(r'\d+(?:\.0+)?',value) and 38000<=float(value)<=50000:
                            day=(dt.datetime(1899,12,30)+dt.timedelta(days=float(value))).date()
                        elif re.fullmatch(r'20\d\d[-/]\d\d[-/]\d\d',value):
                            try: day=dt.date.fromisoformat(value.replace('/','-'))
                            except ValueError: pass
                        if day is not None:
                            if col not in dates:
                                dates[col]=[]
                            dates[col].append(day)
                    element.clear()
            date_cols={col:{'count':len(days),'first':str(min(days)),'last':str(max(days))} for col,days in dates.items()}
            sheets.append({'xml_file':path,'row_count':rows,'date_header_columns':sorted(date_headers),'date_column_candidates':date_cols,'date_cell_storage_types':date_value_formats,'unparsed_date_shapes':sorted(masked_date_samples),'header_topics':sorted(hints)[:16]})
        return sheets

def main():
    result={'source':'SPDR GLD Historical Archive (official)','url':SOURCE,'checked_at_utc':dt.datetime.now(dt.timezone.utc).isoformat(),
            'raw_archive_redistributed':False,'actual_etf_flow_calculated':False,'verified_trade_time_release':False}
    try:
        req=urllib.request.Request(SOURCE,headers={'User-Agent':'Mozilla/5.0','Accept':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})
        with urllib.request.urlopen(req,timeout=45) as response:
            data=response.read(40*1024*1024+1)
            content_type=response.headers.get('Content-Type','')
        if len(data)>40*1024*1024 or not data.startswith(b'PK'):
            raise ValueError('XLSX response invalid or too large')
        result.update(status='official_gld_archive_readable',size_bytes=len(data),content_type=content_type,worksheets=inspect(data))
    except Exception as error:
        result.update(status='official_gld_archive_blocked',error=str(error))
    os.makedirs('reports',exist_ok=True)
    with open('reports/gld-archive-audit-latest.json','w') as f:
        json.dump(result,f,ensure_ascii=False,indent=2)
    print(result['status'],[(x['xml_file'],x['row_count'],x['date_column_candidates']) for x in result.get('worksheets',[])])
    if result.get('error'): print('Archive blocker:',result['error'])

if __name__=='__main__':
    main()
