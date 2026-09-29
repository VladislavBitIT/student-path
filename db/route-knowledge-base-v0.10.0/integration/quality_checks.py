"""Offline content invariants; evidence mapping is not a legal truth oracle."""
import argparse, importlib.util, json, itertools, re
from datetime import date, datetime, timedelta
from pathlib import Path

spec=importlib.util.spec_from_file_location('quality_audit_evaluator',Path(__file__).with_name('audit_scenarios.py'))
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)

def nodes(x):
    if isinstance(x,dict):
        yield x
        for v in x.values():yield from nodes(v)
    elif isinstance(x,list):
        for v in x:yield from nodes(v)

def possible(expr, facts, dictionaries, limit=100000):
    """Search representatives at every predicate boundary. Never call a cap unsatisfiable."""
    leaves=[n for n in nodes(expr) if 'fact' in n];keys=sorted({n['fact'] for n in leaves})
    choices={}
    absent=object()
    for key in keys:
        f=facts[key];typ=f['type'];values=[]
        for n in leaves:
            if n['fact']==key:values += [n['value']] if 'value' in n else n.get('values',[])
        if typ=='boolean':values=[False,True]
        elif typ=='enum':values=[e['code'] for e in dictionaries[f['dictionary_id']]['entries']]
        elif typ in ('number','integer'):
            values=list(set(values+[0]+[v+d for v in values for d in (-1,1)]))
            if typ=='number':values += [(x+y)/2 for x,y in zip(sorted(values),sorted(values)[1:])]
        elif typ in ('date','date_time'):
            values=list(set(values+(['2000-01-01'] if typ=='date' else ['2000-01-01T00:00:00Z'])))
            for v in list(values):
                t=date.fromisoformat(v) if typ=='date' else datetime.fromisoformat(v.replace('Z','+00:00'))
                for d in (-1,1):values.append((t+timedelta(days=d)).isoformat())
        else:values=list(set(values+['__other__']))
        choices[key]=values+[absent]
    # A partial exists predicate has different semantics from a missing completed profile.
    def partial(node,assigned,profile):
        op=node['op']
        if op=='exists' and node['fact'] not in assigned:return None
        if op in ('all','any'):
            xs=[partial(n,assigned,profile) for n in node['args']]
            return a.conjunction(xs) if op=='all' else (True if True in xs else None if None in xs else False)
        if op=='not':
            value=partial(node['arg'],assigned,profile);return None if value is None else not value
        return a.evaluate(node,profile)
    count=0;capped=False
    def visit(i,profile,assigned):
        nonlocal count,capped
        count+=1
        if count>limit:capped=True;return None
        value=partial(expr,assigned,profile)
        if value is False:return None
        if i==len(keys):return dict(profile) if value is True else None
        k=keys[i]
        for v in choices[k]:
            p=dict(profile)
            if v is not absent:p[k]=v
            found=visit(i+1,p,assigned|{k})
            if found is not None:return found
            if capped:return None
        return None
    witness=visit(0,{},set())
    return {'state':'satisfiable' if witness is not None else 'indeterminate' if capped else 'unsatisfiable','witness':witness,'visits':count}

def audit_objects(steps,overlays,scopes):
    errors=[];conditions=[];seen={};titles={}
    for s in steps.values():
        if s['kind']=='federal':
            signature=json.dumps([s['instructions'],s['result']],ensure_ascii=False,sort_keys=True)
            if signature in seen:
                previous=steps[seen[signature]];scope=scopes[None];facts,_,_=a.vocabulary.tables(scope)
                overlap=possible({'op':'all','args':[previous['applicability'],s['applicability']]},facts,scope)
                if overlap['state']!='unsatisfiable':errors.append('Duplicate overlapping federal action: '+previous['id']+' / '+s['id'])
            seen[signature]=s['id']
            if s['title'] in titles:errors.append('Duplicate federal title: '+s['id'])
            titles[s['title']]=s['id']
        scope=scopes[s.get('university_id')];facts,_,_=a.vocabulary.tables(scope)
        expr={'op':'all','args':[s['applicability'],s['trigger'].get('where',{'op':'always'})]}
        finding=possible(expr,facts,scope);conditions.append({'object_id':s['id'],**finding})
        if finding['state']!='satisfiable':errors.append(s['id']+': applicability '+finding['state'])
        if s['deadline']['kind'] in ('relative','partial'):
            if not s.get('trigger'):errors.append(s['id']+': missing trigger')
            if s['deadline']['kind']=='partial':
                k=s['deadline']['known']
                if not k.get('anchor_description') or not k.get('unit'):errors.append(s['id']+': incomplete partial deadline')
        for line in s['instructions']:
            if re.search(r'^обратитесь (?:в университет )?за разъяснением[.!]?$',line.strip(),re.I):errors.append(s['id']+': vague instruction')
    for o in overlays:
        s=steps[o['target_step_id']];scope=scopes[o['university_id']];facts,_,_=a.vocabulary.tables(scope)
        finding=possible({'op':'all','args':[s['applicability'],s['trigger'].get('where',{'op':'always'}),o['applicability']]},facts,scope)
        conditions.append({'object_id':o['id'],**finding})
        if finding['state']!='satisfiable':errors.append(o['id']+': overlay conflicts with target applicability')
        for k in ('deadline','applicability','trigger','depends_on','remove','patch'):
            if k in o['additions']:errors.append(o['id']+': overwrites federal '+k)
        for local in o['additions'].get('local_deadlines',[]):
            if local['scope']!='university_internal':errors.append(o['id']+': invalid local scope')
    return errors,conditions

def run(root):
    root=Path(root);scopes,configs,steps,overlays,_=a.load_package(root)
    errors,conditions=audit_objects(steps,overlays,scopes)
    audit_path=root/'sources/quality_audit.json'
    if audit_path.exists():
        report=a.read(audit_path);sources={s['id'] for s in a.read(root/'sources/sources.json')['items']}
        issues={u['id'] for u in a.read(root/'unresolved/unresolved.json')['items']}
        objects={**steps,**{o['id']:o for o in overlays},**{c['id']:c for c in configs.values()}}
        for claim in report['claims']:
            if claim['object_id'] not in objects:errors.append('Unknown quality object '+claim['object_id']);continue
            obj=objects[claim['object_id']]
            try:
                value=obj
                for part in claim['field'].split('/')[1:]:value=value[int(part)] if isinstance(value,list) else value[part.replace('~1','/').replace('~0','~')]
            except (KeyError,IndexError,ValueError,TypeError):errors.append('Stale quality pointer '+claim['object_id']+claim['field'])
            if set(claim['source_ids'])-sources:errors.append('Unknown quality source')
            if set(claim['unresolved_ids'])-issues:errors.append('Unknown quality issue')
            if claim['state']=='unmapped' and not claim['unresolved_ids']:errors.append('Unmapped claim has no gap')
        if {s['url'] for s in a.read(root/'sources/sources.json')['items']}-{x['url'] for x in report['links']}:errors.append('Source URL missing from link audit')
    return {'passed':not errors,'errors':errors,'conditions':conditions,'scope':'Offline invariants only; current law and operational links require separate content review.'}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1]);p.add_argument('--output',type=Path);args=p.parse_args()
    result=run(args.root);text=json.dumps(result,ensure_ascii=False,indent=2)+'\n'
    if args.output:args.output.write_text(text,encoding='utf-8')
    print(text);raise SystemExit(0 if result['passed'] else 1)
