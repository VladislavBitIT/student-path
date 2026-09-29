"""Data-driven vocabulary scopes. No institution-specific branches."""
from pathlib import Path

DICTIONARY_SCHEMAS = {'schemas/dictionary.schema.json',
                      'schemas/fact_dictionary.schema.json',
                      'schemas/calendar_dictionary.schema.json'}

def build_scopes(manifest, data):
    bindings = {b['path']: b['schema'] for b in manifest['resources']}
    dictionaries = {p: data[p] for p, s in bindings.items() if s in DICTIONARY_SCHEMAS}
    claimed = set()
    def load(paths):
        result = {}
        for path in paths:
            d = dictionaries[path]
            if d['id'] in result: raise ValueError('Duplicate dictionary in scope: '+d['id'])
            if Path(path).stem != d['id']: raise ValueError('Dictionary filename/id mismatch: '+path)
            codes = [e['code'] for e in d['entries']]
            if len(codes) != len(set(codes)): raise ValueError('Duplicate dictionary code: '+path)
            if d.get('status') == 'placeholder' and codes: raise ValueError('Placeholder dictionary must be empty: '+path)
            result[d['id']] = d
        return result
    core_paths = [p for p in dictionaries if p.startswith('dictionaries/')]
    core = load(core_paths); claimed.update(core_paths)
    scopes = {None: core}
    for university in manifest['universities']:
        cfg = data[university['config']]; uid = cfg['id']
        if uid in scopes: raise ValueError('Duplicate university scope: '+uid)
        extension = cfg.get('extension_resources', {})
        pairs = [(extension[k], 'schemas/'+s+'.schema.json') for k,s in
                 [('facts','fact_dictionary'),('event_types','dictionary'),('calendars','calendar_dictionary')]
                 if k in extension]
        pairs += [(p,'schemas/dictionary.schema.json') for p in extension.get('dictionaries', [])]
        paths = [p for p,_ in pairs]
        if len(paths) != len(set(paths)): raise ValueError('Duplicate university resource: '+uid)
        for path, schema in pairs:
            if not path.startswith('universities/'+uid+'/dictionaries/'):
                raise ValueError('Foreign university resource: '+path)
            if bindings.get(path) != schema: raise ValueError('Missing/wrong extension resource binding: '+path)
            if path in claimed: raise ValueError('Shared local resource: '+path)
        for key in ['facts','event_types','calendars']:
            if key in extension and dictionaries[extension[key]]['id'] != key:
                raise ValueError('Wrong extension resource role: '+key)
        local = load(paths); merged = dict(core)
        for key, d in local.items():
            if key in core:
                if key not in ['facts','event_types','calendars']:
                    raise ValueError('Local dictionary shadows core: '+key)
                overlap = {e['code'] for e in core[key]['entries']} & {e['code'] for e in d['entries']}
                if overlap: raise ValueError('Local entries shadow core: '+','.join(sorted(overlap)))
                merged[key] = dict(d, entries=core[key]['entries']+d['entries'])
            else: merged[key] = d
        scopes[uid] = merged; claimed.update(paths)
    if claimed != set(dictionaries): raise ValueError('Unclaimed dictionary resources: '+str(sorted(set(dictionaries)-claimed)))
    # Resolve enums inside their own scope, never through another university.
    for uid,scope in scopes.items():
        for fact in scope['facts']['entries']:
            if fact['type']=='enum' and scope.get(fact['dictionary_id'],{}).get('status') not in ['maintained','placeholder']:
                raise ValueError(f'{uid}: unknown fact dictionary: {fact["code"]}')
    return scopes

def tables(scope):
    return ({f['code']:f for f in scope['facts']['entries']},
            {c['code']:c for c in scope['calendars']['entries']},
            {e['code'] for e in scope['event_types']['entries']})
