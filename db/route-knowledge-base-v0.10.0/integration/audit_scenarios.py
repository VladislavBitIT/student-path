"""Content-only profile audit. Not a production Route Engine or a legal oracle.

Expected outcomes are authored in JSON, independently of this evaluator.
Draft selection is examined here; executable_steps ALWAYS remains empty.
"""
import json
import copy
import importlib.util
from pathlib import Path
from datetime import datetime, timezone

_spec=importlib.util.spec_from_file_location('audit_vocabulary',Path(__file__).with_name('vocabulary.py'))
vocabulary=importlib.util.module_from_spec(_spec);_spec.loader.exec_module(vocabulary)

def read(path):return json.loads(Path(path).read_text(encoding='utf-8'))
def conjunction(xs):
    return False if False in xs else (None if None in xs else True)
def evaluate(expr,facts):
    op=expr['op']
    if op=='always':return True
    if op=='all':return conjunction([evaluate(x,facts) for x in expr['args']])
    if op=='any':
        xs=[evaluate(x,facts) for x in expr['args']]
        return True if True in xs else (None if None in xs else False)
    if op=='not':
        x=evaluate(expr['arg'],facts);return None if x is None else not x
    if op=='exists':return expr['fact'] in facts
    if expr['fact'] not in facts:return None
    a=facts[expr['fact']]
    if op=='in':return a in expr['values']
    if op=='not_in':return a not in expr['values']
    b=expr['value']
    return {'eq':lambda:a==b,'ne':lambda:a!=b,'gt':lambda:a>b,'gte':lambda:a>=b,'lt':lambda:a<b,'lte':lambda:a<=b}[op]()
def instant(s):return datetime.fromisoformat(s.replace('Z','+00:00'))

def active_on(record, at):
    day=instant(at).astimezone(timezone.utc).date().isoformat()
    period=record.get('effective_period',{})
    return record.get('status')!='retired' and not ((period.get('from') and day<period['from']) or (period.get('through') and day>period['through']))

def compose_layers(federal, overlay, config):
    """Non-executable view after selection; keep the complete federal object intact."""
    if overlay['target_step_id']!=federal['id'] or overlay['target_step_version']!=federal['version']:
        raise ValueError('Overlay target mismatch')
    if overlay['university_id']!=config['id'] or overlay['id'] not in config['overlay_ids']:
        raise ValueError('Overlay outside selected configuration')
    return {'federal':copy.deepcopy(federal),'university_additions':copy.deepcopy(overlay['additions']),
            'provenance':{'federal_id':federal['id'],'federal_version':federal['version'],
                          'overlay_id':overlay['id'],'overlay_version':overlay['version'],
                          'university_id':config['id'],'config_schema_version':config['schema_version'],
                          'federal_evidence':copy.deepcopy(federal['evidence']),
                          'overlay_evidence':copy.deepcopy(overlay['evidence'])}}

def load_package(root):
    manifest=read(root/'manifest.json')
    resources={b['path']:read(root/b['path']) for b in manifest['resources']}
    configs={u['config']:read(root/u['config']) for u in manifest['universities']}
    scopes=vocabulary.build_scopes(manifest,dict(resources,**configs))
    steps={s['id']:s for s in [read(root/p) for p in manifest['federal_steps']]}
    overlay_objects=[]
    for university in manifest['universities']:
        for path in university['steps']:
            step=read(root/path);steps[step['id']]=step
        overlay_objects.extend(read(root/path) for path in university['overlays'])
    policy=read(root/'federal/audit/routing_policy.json')
    return scopes,configs,steps,overlay_objects,policy

def run_case(root,case,package=None):
    if case.get('evaluation_mode')!='content_audit':raise ValueError('Only explicit content audit cases are supported')
    scopes,configs,steps,overlay_objects,policy=package if package is not None else load_package(root)
    uid=case.get('university_id')
    if uid not in scopes:raise ValueError('Unknown university')
    facts_spec,_,event_types=vocabulary.tables(scopes[uid])
    for obj in [case]+case['events']:
        if set(obj['facts'])-set(facts_spec):raise ValueError('Facts outside selected university scope')
    if any(e['event_type'] not in event_types for e in case['events']):raise ValueError('Events outside selected university scope')
    facts=dict(case['facts']);snapshots=[];invalidated=[]
    # The case's base profile is the state BEFORE its events, not today's state.
    for event in sorted(case['events'],key=lambda e:(instant(e['occurred_at']),e['id'])):
        if instant(event['occurred_at'])>instant(case['as_of']):continue
        kinds={event['event_type']}
        kinds.update(a['also_triggers'] for a in policy['aliases'] if a['event_type']==event['event_type'])
        reset={f for r in policy['invalidations'] if r['event_type'] in kinds for f in r['facts']}
        for f in reset:
            if f in facts and f not in event['facts']:invalidated.append({'event_id':event['id'],'fact':f})
            facts.pop(f,None)
        facts.update(event['facts'])
        snapshots.append((event,kinds,dict(facts)))
    instances=[];states={};issues=set();local_cfg=next((c for c in configs.values() if c['id']==uid),None)
    for sid in case['scope_step_ids']:
        step=steps[sid];trigger=step['trigger']
        if step.get('kind')=='university' and step['university_id']!=case.get('university_id'):
            states[sid]='excluded';continue
        if step.get('kind')=='university' and local_cfg['status']=='retired':
            states[sid]='excluded';continue
        if trigger['kind']=='profile': candidates=[({'id':'PROFILE','occurred_at':case['as_of']},set(),facts)]
        else:
            candidates=[x for x in snapshots if trigger['event_type'] in x[1]]
            if trigger['occurrence']=='first':candidates=candidates[:1]
            elif trigger['occurrence']=='latest':candidates=candidates[-1:]
        values=[]
        for event,kinds,context in candidates:
            if not active_on(step,event['occurred_at']):continue
            values_here=[evaluate(step['applicability'],context)]
            if trigger['kind']=='event':values_here.append(evaluate(trigger['where'],context))
            value=conjunction(values_here)
            for conflict in policy['conflicts']:
                if sid in conflict['step_ids'] and value is not False and evaluate(conflict['applicability'],context) is True:
                    value=None;issues.update(conflict['unresolved_ids'])
            values.append(value)
            if value is not False:instances.append({'step_id':sid,'event_id':event['id'],'state':'included' if value is True else 'pending'})
        states[sid]='included' if True in values else ('pending' if None in values else 'excluded')
    expected_shape={k+'_step_ids':sorted(s for s,v in states.items() if v==k) for k in ['included','excluded','pending']}
    # A partial legal period is never converted into a precise deadline.
    deadlines=[]
    for d in case['expected']['deadlines']:
        kind=steps[d['step_id']]['deadline']['kind']
        if kind in ['relative','fixed']:raise ValueError('This audit has no production deadline calculator')
        deadlines.append({'step_id':d['step_id'],'state':'none' if kind=='none' else 'unknown'})
    applied=set();pending_overlays=[];composed=[]
    for instance in instances:
        if instance['state']!='included':continue
        context=facts if instance['event_id']=='PROFILE' else next(x[2] for x in snapshots if x[0]['id']==instance['event_id'])
        matching=[];uncertain=[]
        for overlay in overlay_objects:
            if overlay['university_id']!=case.get('university_id') or overlay['target_step_id']!=instance['step_id']:continue
            event_at=case['as_of'] if instance['event_id']=='PROFILE' else next(x[0]['occurred_at'] for x in snapshots if x[0]['id']==instance['event_id'])
            if local_cfg['status']=='retired' or not active_on(overlay,event_at):continue
            if overlay['target_step_version']!=steps[instance['step_id']]['version']:raise ValueError('Overlay version mismatch')
            value=evaluate(overlay['applicability'],context)
            if value is True:matching.append(overlay['id'])
            elif value is None:uncertain.append(overlay['id'])
        if len(matching)>1:raise ValueError('Conflicting overlays')
        if uncertain:pending_overlays.extend(uncertain+matching)
        else:
            applied.update(matching)
            for oid in matching:
                overlay=next(o for o in overlay_objects if o['id']==oid)
                composed.append(dict(compose_layers(steps[instance['step_id']],overlay,local_cfg),event_id=instance['event_id']))
    expected_shape.update(applied_overlay_ids=sorted(applied),unresolved_ids=sorted(issues),deadlines=deadlines)
    return {'expected_shape':expected_shape,'instances':instances,'invalidated':invalidated,'executable_step_ids':[],'pending_overlay_ids':sorted(set(pending_overlays)),'composed_instances':composed,'contexts':dict({e['id']:context for e,_,context in snapshots},PROFILE=facts)}

def run_all(root,collection='tests/federal_scenarios.json'):
    failures=[];cases=read(root/collection)['items']
    package=load_package(root)
    key=lambda x:(x['step_id'],x['event_id'],x['state'])
    results=[]
    for case in cases:
        actual=run_case(root,case,package)
        for field,want in case['expected'].items():
            got=actual['expected_shape'][field]
            if field!='deadlines':want=sorted(want)
            if got!=want:failures.append({'case':case['id'],'field':field,'expected':want,'actual':got})
        if sorted(case['expected_instances'],key=key)!=sorted(actual['instances'],key=key):
            failures.append({'case':case['id'],'field':'instances','expected':case['expected_instances'],'actual':actual['instances']})
        results.append({'id':case['id'],'selected_count':len(actual['expected_shape']['included_step_ids']),'pending_count':len(actual['expected_shape']['pending_step_ids']),'instance_count':len(actual['instances']),'executable_count':0})
    return {'passed':not failures,'case_count':len(cases),'failures':failures,'cases':results}

if __name__=='__main__':
    import sys,argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--collection',choices=['tests/federal_scenarios.json','tests/university_scenarios.json'],default='tests/federal_scenarios.json')
    args=parser.parse_args()
    result=run_all(Path(__file__).resolve().parents[1],args.collection);print(json.dumps(result,ensure_ascii=False,indent=2));sys.exit(0 if result['passed'] else 1)
