"""Offline JSON Schema and cross-reference validation. Python 3.10+."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import importlib.util
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

_spec = importlib.util.spec_from_file_location('kb_vocabulary', Path(__file__).with_name('vocabulary.py'))
vocabulary = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(vocabulary)

FORMATS = FormatChecker()

@FORMATS.checks('date', raises=ValueError)
def valid_date(value):
    if not isinstance(value, str): return True
    return len(value) == 10 and date.fromisoformat(value).isoformat() == value

@FORMATS.checks('date-time', raises=ValueError)
def valid_datetime(value):
    if not isinstance(value, str): return True
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})',value): return False
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    return 'T' in value and parsed.tzinfo is not None

@FORMATS.checks('uri', raises=ValueError)
def valid_uri(value):
    if not isinstance(value, str): return True
    parsed = urlparse(value)
    return bool(parsed.scheme and parsed.netloc) and not any(c.isspace() for c in value)

def strict_json(path):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result: raise ValueError(f'duplicate JSON key: {key}')
            result[key] = value
        return result
    def bad_constant(value): raise ValueError(f'non-JSON constant: {value}')
    return json.loads(path.read_text(encoding='utf-8'), object_pairs_hook=pairs, parse_constant=bad_constant)

def walk(value):
    if isinstance(value, dict):
        yield value
        for child in value.values(): yield from walk(child)
    elif isinstance(value, list):
        for child in value: yield from walk(child)

class Contract:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.schemas = {}
        for path in sorted((self.root / 'schemas').glob('*.schema.json')):
            value = strict_json(path)
            Draft202012Validator.check_schema(value)
            if value['$id'] in [s['$id'] for s in self.schemas.values()]:
                raise ValueError('Duplicate schema $id')
            self.schemas[path.name] = value
        self.registry = Registry().with_resources((s['$id'], Resource.from_contents(s)) for s in self.schemas.values())
        ids = {s['$id'] for s in self.schemas.values()}
        for s in self.schemas.values():
            for node in walk(s):
                if '$ref' in node:
                    from urllib.parse import urljoin
                    if urljoin(s['$id'], node['$ref']).split('#')[0] not in ids:
                        raise ValueError(f"Unresolved schema reference: {node['$ref']}")

    def errors(self, schema, data):
        name = Path(schema).name
        validator = Draft202012Validator(self.schemas[name], registry=self.registry, format_checker=FORMATS)
        return [f'{"/".join(map(str, e.absolute_path)) or "/"}: {e.message}' for e in validator.iter_errors(data)]

    def path(self, relative):
        p = (self.root / relative).resolve()
        if not p.is_relative_to(self.root): raise ValueError(f'Path escapes package: {relative}')
        if not p.is_file(): raise ValueError(f'File missing: {relative}')
        return p

def validate_package(root, as_of=None):
    root = Path(root).resolve()
    as_of = as_of or datetime.now(timezone.utc).date()
    contract = Contract(root)
    errors = []
    def fail(message): errors.append(message)
    manifest = strict_json(root / 'manifest.json')
    errors.extend('manifest: '+e for e in contract.errors('manifest.schema.json', manifest))
    if errors: return errors, {}
    expected_schemas = {'schemas/'+s for s in contract.schemas}
    if set(manifest['schema_files']) != expected_schemas: fail('manifest schema_files differs from schemas directory')
    bindings = list(manifest['resources'])
    bindings += [{'path':p,'schema':'schemas/federal_step.schema.json'} for p in manifest['federal_steps']]
    for uni in manifest['universities']:
        bindings.append({'path':uni['config'],'schema':'schemas/university_config.schema.json'})
        bindings += [{'path':p,'schema':'schemas/university_overlay.schema.json'} for p in uni['overlays']]
        bindings += [{'path':p,'schema':'schemas/university_step.schema.json'} for p in uni['steps']]
    expected_resources = {
        **{f'dictionaries/{x}.json':'dictionary' for x in ['countries','residence_statuses','accommodation_types','event_types']},
        'dictionaries/facts.json':'fact_dictionary','dictionaries/calendars.json':'calendar_dictionary',
        'sources/sources.json':'sources_collection','unresolved/unresolved.json':'unresolved_collection',
        'tests/federal_scenarios.json':'scenarios_collection','tests/university_scenarios.json':'scenarios_collection'
    }
    resource_map = {b['path']:b['schema'] for b in manifest['resources']}
    for p, s in expected_resources.items():
        if resource_map.get(p) != f'schemas/{s}.schema.json': fail(f'Required resource binding missing/wrong: {p}')
    if any(b['schema'] not in manifest['schema_files'] for b in bindings): fail('Unknown schema binding')
    paths = [b['path'] for b in bindings]
    if len(paths) != len(set(paths)): fail('Duplicate manifest resource path')
    if errors: return errors, {}
    data = {}
    for binding in bindings:
        p = binding['path']
        value = strict_json(contract.path(p))
        errs = contract.errors(binding['schema'], value)
        errors.extend(p+': '+e for e in errs)
        data[p] = value
    if errors: return errors, {}
    # Every product JSON must be explicitly loaded; snapshots are evidence, not product data.
    observed = {str(p.relative_to(root)).replace('\\','/') for area in ['dictionaries','federal','universities','unresolved','tests','sources'] for p in (root/area).rglob('*.json') if 'snapshots' not in p.relative_to(root).parts}
    if observed != set(paths): fail(f'Unindexed/mislocated product JSON: {sorted(observed ^ set(paths))}')
    records = {}
    def register(value):
        key = value['id']
        if key in records: fail(f'Duplicate object id: {key}')
        records[key] = value
    for binding in bindings:
        value = data[binding['path']]
        if binding['schema'].endswith('_collection.schema.json'):
            for item in value['items']: register(item)
        elif binding['schema'].split('/')[-1] in ['source.schema.json','federal_step.schema.json','university_step.schema.json','university_overlay.schema.json','university_config.schema.json']:
            register(value)
    sources = {s['id']:s for s in data['sources/sources.json']['items']}
    unresolved = {s['id']:s for s in data['unresolved/unresolved.json']['items']}
    steps = {k:v for k,v in records.items() if v.get('kind') in ['federal','university']}
    overlays = {k:v for k,v in records.items() if k.startswith('OVR_')}
    configs = {k:v for k,v in records.items() if k.startswith('UNIV_')}
    try: scopes = vocabulary.build_scopes(manifest, data)
    except ValueError as exc: return errors+[str(exc)], {}
    dictionaries = scopes[None]
    facts, calendars, events = vocabulary.tables(dictionaries)
    dictionary_records = [(p,v) for p,v in data.items() if resource_map.get(p) in vocabulary.DICTIONARY_SCHEMAS]

    def check_value(code, value, location):
        f = facts.get(code)
        if f is None:
            fail(f'{location}: unknown fact {code}')
            return
        typ = f['type']
        ok = {'string':isinstance(value,str),'number':type(value) in (int,float), 'integer':type(value) is int,
              'boolean':type(value) is bool,'date':isinstance(value,str),'date_time':isinstance(value,str),'enum':isinstance(value,str)}[typ]
        if not ok: fail(f'{location}: wrong type for {code}')
        elif typ in ['date','date_time']:
            try: FORMATS.check(value, 'date' if typ=='date' else 'date-time')
            except Exception: fail(f'{location}: invalid {typ} for {code}')
        elif typ=='enum':
            allowed = {e['code'] for e in dictionaries.get(f['dictionary_id'],{}).get('entries',[])}
            if value not in allowed: fail(f'{location}: undefined value {value!r} for {code}')

    for location, record in list(records.items()) + dictionary_records:
        uid = record.get('university_id')
        if location.startswith('universities/'): uid = location.split('/')[1]
        dictionaries = scopes.get(uid, scopes[None])
        facts, calendars, events = vocabulary.tables(dictionaries)
        for node in walk(record):
            if 'timezone' in node:
                try: ZoneInfo(node['timezone'])
                except (ZoneInfoNotFoundError, ValueError): fail(f'{location}: unknown IANA timezone')
            for period in [node.get('effective_period')]:
                if period and period.get('from') and period.get('through') and period['from']>period['through']: fail(f'{location}: inverted effective period')
            if 'reviewed_at' in node and node['next_review_on'] < node['reviewed_at'][:10]: fail(f'{location}: review date order')
            if 'source_id' in node:
                source = sources.get(node['source_id'])
                if source is None: fail(f'{location}: missing source {node["source_id"]}')
                elif record.get('status')=='verified' and source['verification_status']!='verified': fail(f'{location}: verified object cites unverified source')
                if source and record.get('kind')=='federal' and source['kind']=='university_guidance': fail(f'{location}: federal step cites university guidance')
            for uid in node.get('unresolved_ids',[]):
                if uid not in unresolved: fail(f'{location}: unknown unresolved id {uid}')
            if 'event_type' in node and node['event_type'] not in events: fail(f'{location}: unknown event type {node["event_type"]}')
            if node.get('kind')=='profile':
                for field in node['fields']:
                    if field not in facts: fail(f'{location}: unknown profile field {field}')
            if node.get('kind')=='relative':
                if node.get('calendar_ref') and node['calendar_ref'] not in calendars: fail(f'{location}: unknown calendar')
                if node.get('calendar_ref') in calendars and calendars[node['calendar_ref']]['timezone']!=node['timezone']: fail(f'{location}: calendar/deadline timezone mismatch')
                if node['anchor']['kind']=='fact' and facts.get(node['anchor']['fact'],{}).get('type') not in ['date','date_time']: fail(f'{location}: deadline anchor must be a date fact')
                if node['unit']=='hour' and node['anchor']['kind']=='fact' and facts.get(node['anchor']['fact'],{}).get('type')!='date_time': fail(f'{location}: hourly deadline requires a precise time fact')
            if node.get('kind')=='partial':
                anchor=node['known'].get('anchor_fact')
                if anchor and facts.get(anchor,{}).get('type') not in ['date','date_time']: fail(f'{location}: partial anchor must be a date fact')
            if 'op' in node and 'fact' in node:
                f = node['fact']
                if f not in facts: fail(f'{location}: unknown condition fact {f}')
                if node['op'] in ['gt','gte','lt','lte'] and facts.get(f,{}).get('type') not in ['number','integer','date','date_time']: fail(f'{location}: ordering not supported for fact {f}')
                for value in ([node['value']] if 'value' in node else node.get('values',[])): check_value(f,value,location)
            if 'facts' in node and isinstance(node['facts'],dict):
                for f,v in node['facts'].items(): check_value(f,v,location)
            for key in ['documents','warnings']:
                if key in node:
                    ids = [i['id'] for i in node[key]]
                    if len(ids)!=len(set(ids)): fail(f'{location}: duplicate {key} item id')
        if record.get('deadline',{}).get('kind')=='relative' and record['deadline']['anchor']['kind']=='trigger_event' and record.get('trigger',{}).get('kind')!='event': fail(f'{location}: trigger_event anchor requires event trigger')
    for c in [c for scope in scopes.values() for c in scope['calendars']['entries']]:
        if c['coverage_start']>c['coverage_end']: fail(f'{c["code"]}: calendar period inverted')
        if set(c['non_working_dates']) & set(c['working_dates']): fail(f'{c["code"]}: conflicting calendar overrides')
        if any(not c['coverage_start']<=d<=c['coverage_end'] for d in c['non_working_dates']+c['working_dates']): fail(f'{c["code"]}: date outside calendar coverage')
    for s in sources.values():
        if s.get('superseded_by') and s['superseded_by'] not in sources: fail(f'{s["id"]}: replacement source missing')
        if 'snapshot' in s:
            p = contract.path(s['snapshot']['path'])
            if not s['snapshot']['path'].startswith('sources/snapshots/'): fail(f'{s["id"]}: snapshot must be inside sources/snapshots')
            if hashlib.sha256(p.read_bytes()).hexdigest()!=s['snapshot']['sha256']: fail(f'{s["id"]}: snapshot digest mismatch')
    for u in unresolved.values():
        for oid in u['affected_ids']:
            if oid not in records: fail(f'{u["id"]}: unknown affected object {oid}')
        for sid in u['candidate_source_ids']:
            if sid not in sources: fail(f'{u["id"]}: unknown candidate source {sid}')
    # Research is indexed but is never interpreted as an executable route.
    research = data.get('federal/research/process_map.json')
    audit = data.get('sources/research_audit.json')
    if research:
        research_ids = {p['id'] for p in research['items']}
        covered = set()
        for group in research['coverage']:
            covered.update(group['process_ids'])
        if covered != research_ids: fail('Research coverage differs from process inventory')
        for node in walk(research):
            if 'source_id' in node and node['source_id'] not in sources: fail('Research has missing source')
            for uid in node.get('unresolved_ids', []):
                if uid not in unresolved: fail('Research has missing unresolved item')
            for pid in node.get('process_ids', []):
                if pid not in research_ids: fail('Research has missing process reference')
            if 'calculation_ready' in node:
                if node['unit'] in ['calendar_day','business_day','hour','calendar_month','calendar_year'] and node['amount'] is None:
                    fail('Research numeric deadline lacks an amount')
        for process in research['items']:
            for uid in process['unresolved_ids']:
                if uid in unresolved and process['id'] not in unresolved[uid]['affected_ids']:
                    fail(f'{process["id"]}: unresolved backlink missing')
    if audit:
        audited = [entry['source_id'] for entry in audit['entries']]
        if len(audited) != len(set(audited)) or set(audited) != set(sources): fail('Source audit differs from source register')
    for uni in manifest['universities']:
        cfg = data[uni['config']]
        if not uni['config'].startswith('universities/'+cfg['id']+'/'): fail(f'{cfg["id"]}: config path must match university id')
        for field,files in [('overlay_ids',uni['overlays']),('step_ids',uni['steps'])]:
            if set(cfg[field])!={data[p]['id'] for p in files}: fail(f'{cfg["id"]}: config/manifest mismatch in {field}')
            for p in files:
                if data[p]['university_id']!=cfg['id'] or not p.startswith('universities/'+cfg['id']+'/'): fail(f'{cfg["id"]}: foreign university object {p}')
    for oid,o in overlays.items():
        target = steps.get(o['target_step_id'])
        if not target or target['kind']!='federal': fail(f'{oid}: missing federal target')
        elif target['version']!=o['target_step_version']: fail(f'{oid}: incompatible target version')
        else:
            for field in ['documents','warnings']:
                if {x['id'] for x in target[field]} & {x['id'] for x in o['additions'].get(field,[])}: fail(f'{oid}: addition shadows federal {field}')
        if o['university_id'] not in configs: fail(f'{oid}: missing UniversityConfig')
        if o.get('schema_version')=='1.1.0':
            for edge in o['evidence']:
                for pointer in edge['fields']:
                    target=o
                    try:
                        for part in pointer.lstrip('/').split('/'):
                            key=part.replace('~1','/').replace('~0','~')
                            target=target[int(key)] if isinstance(target,list) else target[key]
                    except (KeyError,IndexError,ValueError,TypeError): fail(f'{oid}: evidence points to missing overlay field')
                if edge['checked_on']>o['review']['reviewed_at'][:10]: fail(f'{oid}: evidence checked after review')
            for local in o['additions'].get('local_deadlines',[]):
                if local['deadline']['kind']=='partial' and local['deadline']['known']['actor']!='student': fail(f'{oid}: internal service turnaround assigned to student')
                if local['state']=='conflict' and local['deadline']['kind'] in ['fixed','relative']: fail(f'{oid}: conflicting local deadline cannot be calculated')
            local_ids=[d['id'] for d in o['additions'].get('local_deadlines',[])]
            if len(local_ids)!=len(set(local_ids)): fail(f'{oid}: duplicate internal deadline id')
    for sid,s in steps.items():
        facts, calendars, events = vocabulary.tables(scopes.get(s.get('university_id'),scopes[None]))
        if s.get('schema_version')=='1.1.0':
            for edge in s['evidence']:
                for pointer in edge['fields']:
                    target=s
                    try:
                        for part in pointer.lstrip('/').split('/'):
                            key=part.replace('~1','/').replace('~0','~')
                            target=target[int(key)] if isinstance(target,list) else target[key]
                    except (KeyError,IndexError,ValueError,TypeError): fail(f'{sid}: evidence points to missing field {pointer}')
                if edge['checked_on']>s['review']['reviewed_at'][:10]: fail(f'{sid}: evidence checked after step review')
            for gap in s.get('field_gaps',[]):
                uid=gap['unresolved_id']
                if uid not in unresolved or sid not in unresolved[uid]['affected_ids']: fail(f'{sid}: field gap lacks valid issue/backlink')
            for pid in s.get('research_process_ids',[]):
                if pid not in records: fail(f'{sid}: missing research process')
            if s['deadline']['kind']=='partial':
                anchor=s['deadline']['known'].get('anchor_fact')
                if anchor and facts.get(anchor,{}).get('type') not in ['date','date_time']: fail(f'{sid}: partial anchor must be a date fact')
                if s['deadline']['known']['actor']!='student': fail(f'{sid}: institutional deadline assigned to student step')
            if s['status']=='verified' and (s.get('field_gaps') or s['deadline']['kind'] in ['unknown','partial']): fail(f'{sid}: verified step has unresolved fields')
        for dep in s['depends_on']:
            target = steps.get(dep)
            if not target: fail(f'{sid}: missing dependency {dep}')
            elif s['kind']=='federal' and target['kind']!='federal': fail(f'{sid}: federal step depends on university step')
            elif target['kind']=='university' and target['university_id']!=s.get('university_id'): fail(f'{sid}: cross-university dependency')
        if s['kind']=='university' and s['university_id'] not in configs: fail(f'{sid}: university missing')
    def cycle_check(graph, label):
        visiting,done=set(),set()
        def visit(key):
            if key in visiting: fail(f'{label}: cycle at {key}'); return
            if key in done: return
            visiting.add(key)
            for child in graph.get(key,[]): visit(child)
            visiting.remove(key); done.add(key)
        for key in graph: visit(key)
    cycle_check({k:v['depends_on'] for k,v in steps.items()},'dependencies')
    cycle_check({k:[v['superseded_by']] if v.get('superseded_by') else [] for k,v in sources.items()},'source supersession')
    scenarios = data['tests/federal_scenarios.json']['items']+data['tests/university_scenarios.json']['items']
    for scenario in scenarios:
        e = scenario['expected']; sid=scenario['id']
        groups=[set(e[k]) for k in ['included_step_ids','excluded_step_ids','pending_step_ids']]
        if any(groups[i]&groups[j] for i in range(3) for j in range(i+1,3)): fail(f'{sid}: overlapping expected step states')
        if scenario.get('evaluation_mode')=='content_audit':
            if set.union(*groups)!=set(scenario['scope_step_ids']): fail(f'{sid}: expected states must partition audit scope')
            for source_id in scenario['source_ids']:
                if source_id not in sources: fail(f'{sid}: unknown audit source')
            keys=[]
            for instance in scenario['expected_instances']:
                step_id=instance['step_id'];event_id=instance['event_id']
                keys.append((step_id,event_id))
                if step_id not in set.union(*groups): fail(f'{sid}: instance outside scope')
                if instance['state']=='included' and step_id not in groups[0]: fail(f'{sid}: included instance has inconsistent aggregate')
                if instance['state']=='pending' and step_id not in groups[0]|groups[2]: fail(f'{sid}: pending instance has inconsistent aggregate')
                if event_id=='PROFILE':
                    if steps.get(step_id,{}).get('trigger',{}).get('kind')!='profile': fail(f'{sid}: PROFILE instance requires profile trigger')
                elif event_id not in {event['id'] for event in scenario['events']}: fail(f'{sid}: missing instance event')
            if len(keys)!=len(set(keys)): fail(f'{sid}: duplicate audit instance')
        for step in set.union(*groups):
            if step not in steps: fail(f'{sid}: unknown expected step {step}')
        for overlay in e['applied_overlay_ids']:
            if overlay not in overlays: fail(f'{sid}: unknown expected overlay')
            elif overlays[overlay]['university_id']!=scenario.get('university_id'): fail(f'{sid}: foreign expected overlay')
        if scenario.get('university_id') and scenario['university_id'] not in configs: fail(f'{sid}: unknown university')
        event_ids=[x['id'] for x in scenario['events']]
        if len(event_ids)!=len(set(event_ids)): fail(f'{sid}: duplicate event id')
        deadline_ids=[x['step_id'] for x in e['deadlines']]
        if len(deadline_ids)!=len(set(deadline_ids)): fail(f'{sid}: duplicate expected deadline')
        for d in e['deadlines']:
            if d['step_id'] not in groups[0]|groups[2]: fail(f'{sid}: deadline for absent step')
    if manifest['content_status']=='scaffold' and (records or any(scope['calendars']['entries'] for scope in scopes.values())): fail('Scaffold must contain no product rules, sources, universities, calendars or scenarios')
    if manifest['production_ready']:
        if not steps or not scenarios: fail('Release requires steps and integration scenarios')
        for key,value in records.items():
            if key.startswith(('FED_','UNI_','OVR_','UNIV_')) and value['status']!='verified': fail(f'{key}: release object not verified')
            if value.get('review') and value['review']['next_review_on'] < as_of.isoformat(): fail(f'{key}: review expired')
        if any(s['verification_status']!='verified' for s in sources.values()): fail('Release contains unverified sources')
        if any(u['severity']=='blocking' and u['status'] in ['open','in_progress'] for u in unresolved.values()): fail('Release has unresolved blockers')
        if any(s['deadline']['kind'] in ['unknown','partial'] or s['destination']['kind']=='unknown' for s in steps.values()): fail('Release contains unknown deadlines/destinations')
    catalog=data.get('federal/catalog.json')
    for path,content in data.items():
        if path.startswith('universities/') and path.endswith('/research/federal_coverage.json'):
            cfg=configs.get(content['university_id'])
            if cfg is None: fail(f'{path}: missing university')
            covered=[r['federal_step_id'] for r in content['rows']]
            federal_ids={k for k,s in steps.items() if s['kind']=='federal'}
            if len(covered)!=len(set(covered)) or set(covered)!=federal_ids: fail(f'{path}: coverage must include every federal step exactly once')
            for row in content['rows']:
                if row['federal_step_id'] in steps and row['federal_step_version']!=steps[row['federal_step_id']]['version']: fail(f'{path}: stale federal coverage version')
                for overlay_id in row['overlay_ids']:
                    if overlay_id not in overlays or overlays[overlay_id]['target_step_id']!=row['federal_step_id'] or overlays[overlay_id]['university_id']!=content['university_id']: fail(f'{path}: wrong coverage overlay')
                for source_id in row['checked_source_ids']:
                    if source_id not in sources: fail(f'{path}: unknown checked source')
                for uid in row['unresolved_ids']:
                    if uid not in unresolved: fail(f'{path}: unknown coverage question')
            for relative,digest in content.get('federal_snapshot',{}).items():
                if not relative.startswith('federal/'): fail(f'{path}: snapshot is not federal')
                elif hashlib.sha256(contract.path(relative).read_bytes()).hexdigest()!=digest: fail(f'{path}: federal baseline changed; refresh university audit explicitly')
    dictionaries = scopes[None]
    facts, calendars, events = vocabulary.tables(dictionaries)
    for path in ['federal/audit/profile_audit.json','federal/audit/routing_policy.json']:
        if path not in data: continue
        for node in walk(data[path]):
            for source_id in node.get('source_ids',[]):
                if source_id not in sources: fail(f'{path}: unknown audit source')
            for step_id in node.get('step_ids',[]):
                if step_id not in steps: fail(f'{path}: unknown audit step')
            for uid in node.get('unresolved_ids',[]):
                if uid not in unresolved: fail(f'{path}: unknown audit issue')
            if 'event_type' in node and node['event_type'] not in events: fail(f'{path}: unknown audit event')
            if 'also_triggers' in node and node['also_triggers'] not in events: fail(f'{path}: unknown event alias target')
            if isinstance(node.get('facts'),list):
                for fact in node['facts']:
                    if fact not in facts: fail(f'{path}: unknown invalidated fact')
            if 'op' in node and 'fact' in node:
                if node['fact'] not in facts: fail(f'{path}: unknown policy fact')
                for value in ([node['value']] if 'value' in node else node.get('values',[])): check_value(node['fact'],value,path)
    if catalog:
        indexed=[sid for c in catalog['categories'] for sid in c['step_ids']]
        if len(indexed)!=len(set(indexed)) or set(indexed)!={k for k,s in steps.items() if s['kind']=='federal'}: fail('Federal catalog differs from steps')
        for c in catalog['categories']:
            for sid in c['step_ids']:
                if sid in steps and steps[sid].get('category')!=c['code']: fail('Federal category mismatch')
        mapped_processes=[p['process_id'] for p in catalog['process_disposition']]
        if research and (len(mapped_processes)!=len(set(mapped_processes)) or set(mapped_processes)!={p['id'] for p in research['items']}): fail('Process disposition does not cover research inventory')
        for mapping in catalog['process_disposition']:
            expected={sid for sid,s in steps.items() if mapping['process_id'] in s.get('research_process_ids',[])}
            if set(mapping['step_ids'])!=expected: fail('Process-to-step mapping mismatch')
    route_suite=data.get('tests/route_scenarios.json')
    if route_suite:
        spec=importlib.util.spec_from_file_location('package_route_tests',root/'integration/route_tests.py')
        route_tests=importlib.util.module_from_spec(spec);spec.loader.exec_module(route_tests)
        errors.extend(route_tests.validate_suite(root,route_suite))
    return errors, {'schema_count':len(contract.schemas),'data_file_count':len(data)+1,'federal_step_count':sum(s['kind']=='federal' for s in steps.values()),'university_count':len(configs),'overlay_count':len(overlays),'university_step_count':sum(s['kind']=='university' for s in steps.values()),'scenario_count':len(scenarios),'route_case_count':len(route_suite['cases']) if route_suite else 0,'deadline_case_count':len(data.get('tests/deadline_cases.json',{}).get('cases',[])),'research_process_count':len(research['items']) if research else 0,'source_count':len(sources),'unresolved_count':len(unresolved),'content_status':manifest['content_status'],'production_ready':manifest['production_ready']}

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1])
    p.add_argument('--as-of',type=date.fromisoformat)
    args=p.parse_args()
    try:
        errors,summary=validate_package(args.root,args.as_of)
    except Exception as exc:
        print(f'ERROR: {exc}',file=sys.stderr); return 1
    print(json.dumps({'valid':not errors,'summary':summary,'errors':errors},ensure_ascii=False,indent=2))
    return 1 if errors else 0

if __name__=='__main__': sys.exit(main())
