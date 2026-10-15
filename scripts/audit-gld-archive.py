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
            first_column_a={'cells':0,'nonempty':0,'types':{},'first_nonempty_row':None,'last_nonempty_row':None,'masked_examples':set()}
            date_header_row=None
            topic_columns={}
            tonnes_pairs=[]
            with z.open(path) as sheet:
                for _,element in ET.iterparse(sheet,events=('end',)):
                    if element.tag!=X+'row':
                        continue
                    rows+=1
                    row_date=None
                    row_tonnes=None
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
                        if col=='A':
                            first_column_a['cells']+=1
                            typ=cell.attrib.get('t','numeric')
                            first_column_a['types'][typ]=first_column_a['types'].get(typ,0)+1
                            if value:
                                first_column_a['nonempty']+=1
                                first_column_a['first_nonempty_row']=first_column_a['first_nonempty_row'] or rows
                                first_column_a['last_nonempty_row']=rows
                                if len(first_column_a['masked_examples'])<6:
                                    first_column_a['masked_examples'].add(re.sub(r'\d','#',value[:35]))
                        if not value:
                            continue
                        if rows<=20 and value.strip().lower()=='date':
                            date_headers.add(col)
                            date_header_row=rows
                            topic_columns['date']=col
                        if rows<=20 and value.strip().lower().startswith('tonnes of gold'):
                            topic_columns['gold_tonnes']=col
                        if rows<=20 and 'total ounces of gold in the trust' in value.strip().lower():
                            topic_columns['total_ounces']=col
                        if rows<=20 and len(value)<=80 and any(x in value.lower() for x in ('date','tonne','hold','ounce','share')):
                            hints.add(re.sub(r'\s+',' ',value))
                        if col==topic_columns.get('gold_tonnes') and rows>(date_header_row or 1):
                            try:
                                candidate=float(value.replace(',','').strip())
                                if 0<candidate<20000:
                                    row_tonnes=candidate
                            except ValueError:
                                pass
                        if col not in date_headers or value.strip().lower()=='date':
                            continue
                        date_value_formats[cell.attrib.get('t','numeric')]=date_value_formats.get(cell.attrib.get('t','numeric'),0)+1
                        day=None
                        if re.fullmatch(r'\d+(?:\.0+)?',value) and 38000<=float(value)<=50000:
                            day=(dt.datetime(1899,12,30)+dt.timedelta(days=float(value))).date()
                        else:
                            for pattern in ('%Y-%m-%d','%Y/%m/%d','%m/%d/%Y','%m/%d/%y','%d-%b-%Y','%d-%b-%y','%b %d, %Y','%d %b %Y','%Y-%m-%dT%H:%M:%S','%d/%m/%Y','%m-%d-%Y'):
                                try:
                                    day=dt.datetime.strptime(value,pattern).date()
                                    break
                                except ValueError:
                                    continue
                        if day is None and len(masked_date_samples)<5:
                            masked_date_samples.add(re.sub(r'\d','#',value[:35]))
                        if day is not None:
                            if col==topic_columns.get('date'):
                                row_date=day
                            if col not in dates:
                                dates[col]=[]
                            dates[col].append(day)
                    if row_date is not None and row_tonnes is not None:
                        tonnes_pairs.append((row_date,row_tonnes))
                    element.clear()
            tonnes_pairs.sort(key=lambda item:item[0])
            distinct_dates={day for day,_ in tonnes_pairs}
            if len(distinct_dates)!=len(tonnes_pairs):
                tonnes_pairs=[]  # fail closed rather than pick among duplicate original dates
            transitions=[(d,tonnes_pairs[i][1]-tonnes_pairs[i-1][1]) for i,(d,_) in enumerate(tonnes_pairs) if i>0]
            changes_by_year={}
            for year in (2024,2025,2026):
                subset=[delta for day,delta in transitions if day.year==year]
                changes_by_year[str(year)]={'sample_days':len(subset),'holdings_increased_days':sum(delta>0 for delta in subset),'holdings_decreased_days':sum(delta<0 for delta in subset),'holdings_unchanged_days':sum(delta==0 for delta in subset)}
            tonnes_coverage={'valid_date_tonnes_pairs':len(tonnes_pairs),'first_date':str(tonnes_pairs[0][0]) if tonnes_pairs else None,'last_date':str(tonnes_pairs[-1][0]) if tonnes_pairs else None,'historical_daily_change_samples':len(transitions),'counts_by_year':changes_by_year,'true_net_etf_flow_not_inferred':True}
            date_cols={col:{'count':len(days),'first':str(min(days)),'last':str(max(days))} for col,days in dates.items()}
            first_column_a['masked_examples']=sorted(first_column_a['masked_examples'])
            sheets.append({'xml_file':path,'row_count':rows,'date_header_row':date_header_row,'first_column_a_debug':first_column_a,'topic_columns':topic_columns,'gold_tonnes_change_coverage':tonnes_coverage,'date_header_columns':sorted(date_headers),'date_column_candidates':date_cols,'date_cell_storage_types':date_value_formats,'unparsed_date_shapes':sorted(masked_date_samples),'header_topics':sorted(hints)[:16]})
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
