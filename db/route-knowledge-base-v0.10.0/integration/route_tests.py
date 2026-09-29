"""Canonical UserProfile/Events contract tests. Draft results are never executable."""
import argparse, importlib.util, json, sys
from datetime import date, datetime
from pathlib import Path

def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
HERE=Path(__file__).resolve().parent
audit=module('route_content_audit',HERE/'audit_scenarios.py')
clock=module('route_deadline_calculator',HERE/'deadlines.py')
read=audit.read

def inventory(root):
    m=read(root/'manifest.json')
    configs={read(root/u['config'])['id']:read(root/u['config']) for u in m['universities']}
    steps={s['id']:s for s in [read(root/p) for p in m['federal_steps']+[p for u in m['universities'] for p in u['steps']]]}
    overlays={o['id']:o for o in [read(root/p) for u in m['universities'] for p in u['overlays']]}
    data={b['path']:read(root/b['path']) for b in m['resources']}
    data.update({u['config']:configs[read(root/u['config'])['id']] for u in m['universities']})
    return configs,steps,overlays,audit.vocabulary.build_scopes(m,data)

def ordering(steps,included):
    pairs=set()
    def ancestors(sid,trail):
        if sid in trail:raise ValueError('Dependency cycle')
        found=set()
        for dep in steps[sid]['depends_on']:
            found.add(dep);found.update(ancestors(dep,trail|{sid}))
        return found
    for sid in included:
        for dep in ancestors(sid,set()) & set(included):pairs.add((dep,sid))
    return [{'before_step_id':x,'after_step_id':y} for x,y in sorted(pairs)]

def check_facts(values,scope,location,errors):
    defs,_,_=audit.vocabulary.tables(scope)
    for key,value in values.items():
        f=defs.get(key)
        if f is None:errors.append(f'{location}: unknown scoped fact {key}');continue
        typ=f['type']
        ok={'string':isinstance(value,str),'enum':isinstance(value,str),'boolean':type(value) is bool,
            'integer':type(value) is int,'number':type(value) in (int,float),'date':isinstance(value,str),'date_time':isinstance(value,str)}[typ]
        if not ok:errors.append(f'{location}: wrong fact type {key}');continue
        if typ=='enum' and value not in {e['code'] for e in scope[f['dictionary_id']]['entries']}:errors.append(f'{location}: undefined enum value {key}')
        if typ in ['date','date_time']:
            try:
                if typ=='date':assert len(value)==10 and date.fromisoformat(value).isoformat()==value
                else:assert clock.instant(value).tzinfo is not None and 'T' in value
            except (ValueError,AssertionError):errors.append(f'{location}: invalid date fact {key}')

def validate_suite(root,suite):
    configs,steps,overlays,scopes=inventory(root);errors=[];ids=[]
    sources={s['id'] for s in read(root/'sources/sources.json')['items']}
    unresolved={u['id'] for u in read(root/'unresolved/unresolved.json')['items']}
    for c in suite['cases']:
        cid=c['id'];ids.append(cid);e=c['expected'];uni=c['university'];uid=uni.get('id')
        if uni['state']=='configured' and uid not in configs:errors.append(f'{cid}: missing configured university')
        if uni['state']=='unconfigured' and uid in configs:errors.append(f'{cid}: university unexpectedly configured')
        scope=scopes.get(uid,scopes[None]) if uni['state']=='configured' else scopes[None]
        _,_,event_types=audit.vocabulary.tables(scope)
        check_facts(c['user_profile']['facts'],scope,cid,errors)
        event_ids=[x['id'] for x in c['events']]
        if len(event_ids)!=len(set(event_ids)) or 'PROFILE' in event_ids:errors.append(f'{cid}: duplicate/reserved event id')
        for event in c['events']:
            check_facts(event['facts'],scope,cid,errors)
            if event['event_type'] not in event_types:errors.append(f'{cid}: unknown scoped event')
        groups=[set(e[k]) for k in ['steps','forbidden_steps','pending_steps']]
        if any(groups[i]&groups[j] for i in range(3) for j in range(i+1,3)):errors.append(f'{cid}: overlapping expected states')
        if set.union(*groups)!=set(c['scope_step_ids']):errors.append(f'{cid}: expected states do not partition scope')
        if set(c['scope_step_ids'])-set(steps):errors.append(f'{cid}: unknown scoped steps');continue
        if set(c['source_ids'])-sources or set(e['unresolved_ids'])-unresolved:errors.append(f'{cid}: missing source/issue reference')
        if e['executable_steps']:errors.append(f'{cid}: draft content audit cannot expect executable steps')
        seen=set()
        for item in e['instances']:
            key=(item['step_id'],item['event_id'])
            if key in seen:errors.append(f'{cid}: duplicate expected instance')
            seen.add(key)
            sid,event_id=key
            if sid not in groups[0]|groups[2]:errors.append(f'{cid}: instance for forbidden/absent step');continue
            if event_id=='PROFILE':
                if steps[sid]['trigger']['kind']!='profile':errors.append(f'{cid}: event step has PROFILE instance')
            elif event_id not in event_ids:errors.append(f'{cid}: missing expected event')
            elif clock.instant(next(x['occurred_at'] for x in c['events'] if x['id']==event_id))>clock.instant(c['as_of']):errors.append(f'{cid}: future expected instance')
        for state,group in [('included',groups[0]),('pending',groups[2])]:
            for sid in group:
                values={i['state'] for i in e['instances'] if i['step_id']==sid}
                if (state=='included' and 'included' not in values) or (state=='pending' and values!={'pending'}):errors.append(f'{cid}: aggregate/instance disagreement')
        ovkeys=set()
        for item in e['overlays']:
            key=(item['overlay_id'],item['step_id'],item['event_id'])
            if key in ovkeys:errors.append(f'{cid}: duplicate overlay instance')
            ovkeys.add(key);o=overlays.get(item['overlay_id'])
            if not o or uni['state']!='configured' or o['university_id']!=uid or o['target_step_id']!=item['step_id']:errors.append(f'{cid}: foreign/wrong overlay')
            if not any(i['step_id']==item['step_id'] and i['event_id']==item['event_id'] and i['state']=='included' for i in e['instances']):errors.append(f'{cid}: overlay has no included base')
        for oid in e['pending_overlay_ids']:
            if oid not in overlays or uni['state']!='configured' or overlays[oid]['university_id']!=uid:errors.append(f'{cid}: foreign pending overlay')
        for pair in e['ordering']['before']:
            if pair['before_step_id'] not in groups[0] or pair['after_step_id'] not in groups[0]:errors.append(f'{cid}: order references absent step')
        if e['ordering']['before']!=ordering(steps,e['steps']):errors.append(f'{cid}: invented or missing dependency order')
        keys=[];base_deadlines=set()
        for d in e['deadlines']:
            key=(d['step_id'],d['event_id'],d.get('overlay_id'),d.get('local_deadline_id'));keys.append(key)
            if key[:2] not in seen:errors.append(f'{cid}: deadline without instance');continue
            if 'overlay_id' not in d:
                base_deadlines.add(key[:2]);model=steps[d['step_id']]['deadline']
                want='federal' if steps[d['step_id']]['kind']=='federal' else 'university_internal'
                if d['layer']!=want:errors.append(f'{cid}: deadline layer mismatch')
            else:
                o=overlays.get(d['overlay_id']);model=next((x['deadline'] for x in o['additions'].get('local_deadlines',[]) if x['id']==d['local_deadline_id']),None) if o else None
                if (d['overlay_id'],d['step_id'],d['event_id']) not in ovkeys or model is None:errors.append(f'{cid}: deadline for absent overlay');continue
            if d['state']=='known' and model['kind'] not in ['fixed','relative']:errors.append(f'{cid}: fabricated calculable deadline')
        if len(keys)!=len(set(keys)):errors.append(f'{cid}: duplicate deadline expectation')
        if base_deadlines!=seen:errors.append(f'{cid}: missing base deadline expectation')
    if len(ids)!=len(set(ids)):errors.append('Duplicate route scenario id')
    return errors

def run_case(root,c,prepared=None):
    loaded,package=prepared if prepared is not None else (inventory(root),audit.load_package(root))
    configs,steps,overlays,scopes=loaded;uni=c['university']
    uid=uni.get('id') if uni['state']=='configured' else None
    old={'evaluation_mode':'content_audit','facts':c['user_profile']['facts'],'events':c['events'],
         'as_of':c['as_of'],'scope_step_ids':c['scope_step_ids'],'expected':{'deadlines':[]}}
    if uid:old['university_id']=uid
    raw=audit.run_case(root,old,package);shape=raw['expected_shape'];deadline_results=[]
    for i in raw['instances']:
        sid=i['step_id'];eid=i['event_id'];step=steps[sid]
        context=raw['contexts'][eid];trigger=next((e for e in c['events'] if e['id']==eid),None)
        scope=scopes[None if step['kind']=='federal' else uid];_,calendars,_=audit.vocabulary.tables(scope)
        result=clock.calculate(step['deadline'],context,c['events'],trigger,c['as_of'],calendars) if i['state']=='included' else {'state':'unknown'}
        result.pop('reason',None)
        deadline_results.append(dict(result,step_id=sid,event_id=eid,layer='federal' if step['kind']=='federal' else 'university_internal'))
    overlay_instances=[]
    for view in raw['composed_instances']:
        p=view['provenance'];eid=view['event_id'];sid=p['federal_id'];oid=p['overlay_id']
        overlay_instances.append({'overlay_id':oid,'step_id':sid,'event_id':eid})
        _,calendars,_=audit.vocabulary.tables(scopes[uid])
        context=raw['contexts'][eid];trigger=next((e for e in c['events'] if e['id']==eid),None)
        for local in view['university_additions'].get('local_deadlines',[]):
            applies=audit.evaluate(local['applicability'],context)
            if applies is False:continue
            result=clock.calculate(local['deadline'],context,c['events'],trigger,c['as_of'],calendars) if applies is True else {'state':'unknown'}
            result.pop('reason',None)
            deadline_results.append(dict(result,step_id=sid,event_id=eid,layer='university_internal',overlay_id=oid,local_deadline_id=local['id']))
    return {'steps':shape['included_step_ids'],'forbidden_steps':shape['excluded_step_ids'],'pending_steps':shape['pending_step_ids'],
        'instances':raw['instances'],'overlays':overlay_instances,'pending_overlay_ids':raw['pending_overlay_ids'],
        'ordering':{'kind':'partial_order','before':ordering(steps,shape['included_step_ids'])},'deadlines':deadline_results,
        'unresolved_ids':shape['unresolved_ids'],'executable_steps':raw['executable_step_ids']}

def normalized(value):
    if isinstance(value,list):return sorted((normalized(x) for x in value),key=lambda x:json.dumps(x,sort_keys=True))
    if isinstance(value,dict):return {k:normalized(v) for k,v in value.items() if k!='note'}
    return value

def run_all(root):
    suite=read(root/'tests/route_scenarios.json');failures=[]
    prepared=(inventory(root),audit.load_package(root))
    consistency=validate_suite(root,suite)
    for c in suite['cases']:
        try:actual=run_case(root,c,prepared)
        except Exception as exc:failures.append({'case':c['id'],'error':str(exc)});continue
        for key,want in c['expected'].items():
            if normalized(want)!=normalized(actual[key]):failures.append({'case':c['id'],'field':key,'expected':want,'actual':actual[key]})
    clockcases=read(root/'tests/deadline_cases.json')['cases'];clock_ids=[]
    for c in clockcases:
        clock_ids.append(c['id'])
        try:actual=clock.calculate(c['model'],c['facts'],c['events'],c['trigger_event'],c['as_of'],c['calendars'])
        except Exception as exc:failures.append({'case':c['id'],'error':str(exc)});continue
        if actual!=c['expected']:failures.append({'case':c['id'],'field':'deadline','expected':c['expected'],'actual':actual})
    if len(clock_ids)!=len(set(clock_ids)):consistency.append('Duplicate calculator scenario id')
    return {'passed':not failures and not consistency,'route_case_count':len(suite['cases']),'deadline_case_count':len(clockcases),'consistency_errors':consistency,'failures':failures}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--root',type=Path,default=HERE.parent);args=parser.parse_args()
    validator=module('route_suite_schema_validation',HERE/'validate.py');errors,_=validator.validate_package(args.root)
    result={'passed':False,'schema_errors':errors} if errors else run_all(args.root)
    print(json.dumps(result,ensure_ascii=False,indent=2));sys.exit(0 if result['passed'] else 1)
