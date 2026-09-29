"""Synthetic contract checks only; no migration rules or external services."""
import copy
import importlib.util
import json
import os
import shutil
import unittest
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('kb_validate', ROOT/'integration/validate.py')
v = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v)

def evidence(): return [{'source_id':'SRC_SYNTHETIC','locator':'Synthetic section','supports':'Synthetic test only'}]
def review(): return {'reviewed_at':'2000-01-01T00:00:00Z','reviewer':'Synthetic reviewer','next_review_on':'2099-01-01'}
def source():
    return {'schema_version':'1.0.0','id':'SRC_SYNTHETIC','title':'Synthetic source; not evidence of a real rule',
            'kind':'other','publisher':'Synthetic','url':'https://example.invalid/synthetic','jurisdiction':'Synthetic',
            'language':'ru','retrieved_at':'2000-01-01T00:00:00Z','verification_status':'unverified'}
def step():
    return {'schema_version':'1.0.0','id':'FED_SYNTHETIC','kind':'federal','version':1,'status':'draft',
            'title':'Synthetic action','summary':'No real-world meaning','applicability':{'op':'always'},
            'trigger':{'kind':'event','event_type':'synthetic_event','occurrence':'each','where':{'op':'always'}},
            'deadline':{'kind':'none','reason':'Synthetic'},'instructions':['Synthetic instruction'],
            'documents':[],'destination':{'kind':'none','reason':'Synthetic'},
            'result':{'title':'Synthetic result','completion_mode':'user_confirmation'},'warnings':[],
            'depends_on':[],'effective_period':{},'evidence':evidence(),'unresolved_ids':[]}
def overlay():
    return {'schema_version':'1.0.0','id':'OVR_SYNTHETIC','university_id':'UNIV_SYNTHETIC','target_step_id':'FED_SYNTHETIC',
            'target_step_version':1,'version':1,'status':'draft','applicability':{'op':'always'},'effective_period':{},
            'additions':{'instructions':['Synthetic university instruction']},'evidence':evidence(),'unresolved_ids':[]}
def config():
    return {'schema_version':'1.0.0','id':'UNIV_SYNTHETIC','name':'Synthetic university','status':'draft',
            'timezone':'Etc/UTC','contacts':[],'overlay_ids':['OVR_SYNTHETIC'],'step_ids':[],'evidence':[]}
def relative_deadline():
    return {'kind':'relative','anchor':{'kind':'trigger_event'},'amount':2,'unit':'calendar_day','direction':'after',
            'include_anchor_day':False,'time_of_day':'12:00:00','timezone':'Etc/UTC','rollover':'none','month_end':'clamp'}
def unresolved():
    return {'schema_version':'1.0.0','id':'UNR_SYNTHETIC','status':'open','severity':'blocking','question':'Synthetic question',
            'affected_ids':['FED_SYNTHETIC'],'created_at':'2000-01-01T00:00:00Z','candidate_source_ids':[]}
def scenario():
    return {'schema_version':'1.0.0','id':'TEST_SYNTHETIC','title':'Synthetic scenario','as_of':'2000-01-01T00:00:00Z',
            'facts':{},'events':[],'expected':{'included_step_ids':['FED_SYNTHETIC'],'excluded_step_ids':[],
            'pending_step_ids':[],'applied_overlay_ids':[],'unresolved_ids':[],'deadlines':[]}}

class SchemaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls): cls.contract=v.Contract(ROOT)
    def valid(self,name,data): self.assertEqual(self.contract.errors(name+'.schema.json',data),[])
    def invalid(self,name,data): self.assertTrue(self.contract.errors(name+'.schema.json',data))
    def test_all_requested_models_valid(self):
        uni=step(); uni.update(id='UNI_SYNTHETIC',kind='university',university_id='UNIV_SYNTHETIC')
        models={'source':source(),'federal_step':step(),'university_overlay':overlay(),'university_step':uni,
                'university_config':config(),'applicability':{'op':'all','args':[{'op':'always'},{'op':'not','arg':{'op':'exists','fact':'arrival_on'}}]},
                'trigger':step()['trigger'],'deadline':relative_deadline(),
                'documents':[{'id':'DOC_SYNTHETIC','title':'Synthetic','requirement':'required','form':'digital','evidence':evidence()}],
                'destination':{'kind':'online','name':'Synthetic','url':'https://example.invalid','contacts':[],'appointment_required':'unknown'},
                'result':step()['result'],'warnings':[{'id':'WARN_SYNTHETIC','severity':'warning','message':'Synthetic','evidence':evidence()}],
                'unresolved_item':unresolved(),'test_scenario':scenario()}
        for name,data in models.items():
            with self.subTest(name=name): self.valid(name,data)
    def test_unknown_fields_rejected(self):
        for name,data in [('source',source()),('federal_step',step()),('university_overlay',overlay()),('university_config',config())]:
            data['unexpected']=True
            with self.subTest(name=name): self.invalid(name,data)
    def test_overlay_cannot_override_federal(self):
        for forbidden in ['deadline','applicability','status','depends_on','evidence','remove','patch']:
            o=overlay(); o['additions'][forbidden]={}
            with self.subTest(field=forbidden): self.invalid('university_overlay',o)
    def test_overlay_empty_additions_rejected(self):
        o=overlay(); o['additions']={}; self.invalid('university_overlay',o)
        o['additions']={'documents':[]}; self.invalid('university_overlay',o)
    def test_relative_business_days_require_calendar(self):
        d=relative_deadline(); d['unit']='business_day'; self.invalid('deadline',d)
        d['calendar_ref']='synthetic_calendar'; self.valid('deadline',d)
    def test_hour_offset_has_no_wall_clock_override(self):
        d=relative_deadline(); d['unit']='hour'; self.invalid('deadline',d)
        del d['time_of_day']; self.valid('deadline',d)
    def test_date_time_format(self):
        for at in ['2000-02-30T00:00:00Z','2000-01-01T00:00:00','2000-01-01T00:00Z','not-a-date']:
            with self.subTest(at=at): self.invalid('deadline',{'kind':'fixed','at':at})
    def test_unknown_deadline_requires_unresolved(self):
        self.invalid('deadline',{'kind':'unknown','unresolved_ids':[]})
        self.valid('deadline',{'kind':'unknown','unresolved_ids':['UNR_SYNTHETIC']})
    def test_negative_offset_rejected(self):
        d=relative_deadline(); d['amount']=-1; self.invalid('deadline',d)
    def test_month_offset_cannot_include_anchor_day(self):
        d=relative_deadline(); d['unit']='calendar_month'; d['include_anchor_day']=True; self.invalid('deadline',d)
    def test_conditional_document_requires_condition(self):
        d={'id':'DOC_SYNTHETIC','title':'Synthetic','requirement':'conditional','form':'digital','evidence':evidence()}
        self.invalid('documents',[d]); d['condition']={'op':'always'}; self.valid('documents',[d])
    def test_verified_requires_review(self):
        s=step(); s['status']='verified'; self.invalid('federal_step',s)
        s['review']=review(); self.valid('federal_step',s)
    def test_expression_requires_nonempty_operands(self):
        self.invalid('applicability',{'op':'all','args':[]})
        self.invalid('applicability',{'op':'eq','fact':'arrival_on','value':None})
    def test_resolved_issue_requires_evidence(self):
        u=unresolved(); u['status']='resolved'; self.invalid('unresolved_item',u)
    def test_expected_deadline_consistency(self):
        s=scenario(); s['expected']['deadlines']=[{'step_id':'FED_SYNTHETIC','state':'known'}]
        self.invalid('test_scenario',s)
    def test_service_result_requires_event(self):
        self.invalid('result',{'title':'Synthetic','completion_mode':'service_event'})
    def test_real_destination_requires_address_or_url(self):
        self.invalid('destination',{'kind':'physical','name':'Synthetic','contacts':[],'appointment_required':'no'})

class PackageTests(unittest.TestCase):
    def setUp(self):
        self.scratch=Path(os.environ.get('KB_TEST_SCRATCH',ROOT.parent/'work_contract_tests')).resolve()
        self.scratch.mkdir(parents=True,exist_ok=True)
        self.root=self.scratch/('kb_'+uuid.uuid4().hex)
        shutil.copytree(ROOT,self.root,ignore=shutil.ignore_patterns('__pycache__'))
        # Contract tests use an isolated empty fixture, independent of research content.
        m=self.read('manifest.json')
        for university in m['universities']:
            for path in [university['config']]+university['steps']+university['overlays']:
                (self.root/path).unlink()
        m['universities']=[]
        for path in m['federal_steps']:
            (self.root/path).unlink()
        m['federal_steps']=[]
        for binding in list(m['resources']):
            if binding['path'].startswith('universities/') or binding['path'] in ['federal/research/process_map.json','sources/research_audit.json','federal/catalog.json','federal/audit/profile_audit.json','federal/audit/routing_policy.json']:
                (self.root/binding['path']).unlink()
                m['resources'].remove(binding)
        m['content_status']='scaffold'; m['production_ready']=False
        self.put('manifest.json',m)
        for path in ['sources/sources.json','unresolved/unresolved.json','tests/federal_scenarios.json','tests/university_scenarios.json']:
            self.put(path,{'schema_version':'1.0.0','items':[]})
        for path in ['tests/route_scenarios.json','tests/deadline_cases.json']:
            self.put(path,{'schema_version':'1.0.0','purpose':'Empty synthetic fixture','cases':[]})
    def tearDown(self):
        # Remove only this test's explicitly created directory, within the scratch root.
        target=self.root.resolve()
        if target.parent!=self.scratch or not target.name.startswith('kb_'): raise RuntimeError('Unsafe cleanup path')
        shutil.rmtree(target)
    def read(self,path): return v.strict_json(self.root/path)
    def put(self,path,data):
        p=self.root/path; p.parent.mkdir(parents=True,exist_ok=True)
        p.write_text(json.dumps(data,ensure_ascii=False),encoding='utf-8')
    def draft(self):
        m=self.read('manifest.json'); m['content_status']='draft'; m['federal_steps']=['federal/steps/FED_SYNTHETIC.json']; self.put('manifest.json',m)
        self.put('federal/steps/FED_SYNTHETIC.json',step())
        self.put('sources/sources.json',{'schema_version':'1.0.0','items':[source()]})
        e=self.read('dictionaries/event_types.json'); e['status']='maintained'; e['entries']=[{'code':'synthetic_event','label':'Synthetic'}]; self.put('dictionaries/event_types.json',e)
    def add_university(self):
        m=self.read('manifest.json'); base='universities/UNIV_SYNTHETIC/'
        m['universities']=[{'config':base+'university.json','overlays':[base+'overlays/OVR_SYNTHETIC.json'],'steps':[]}]; self.put('manifest.json',m)
        self.put(base+'university.json',config()); self.put(base+'overlays/OVR_SYNTHETIC.json',overlay())
    def errors(self): return v.validate_package(self.root)[0]
    def test_empty_scaffold_valid(self): self.assertEqual(self.errors(),[])
    def test_synthetic_draft_valid(self): self.draft(); self.add_university(); self.assertEqual(self.errors(),[])
    def test_missing_source_rejected(self):
        self.draft(); self.put('sources/sources.json',{'schema_version':'1.0.0','items':[]}); self.assertTrue(self.errors())
    def test_dependency_cycle_rejected(self):
        self.draft(); s=step(); s['depends_on']=[s['id']]; self.put('federal/steps/FED_SYNTHETIC.json',s); self.assertTrue(self.errors())
    def test_unknown_fact_rejected(self):
        self.draft(); s=step(); s['applicability']={'op':'eq','fact':'missing','value':'x'}; self.put('federal/steps/FED_SYNTHETIC.json',s); self.assertTrue(self.errors())
    def test_fact_type_rejected(self):
        self.draft(); s=step(); s['applicability']={'op':'eq','fact':'arrival_on','value':1}; self.put('federal/steps/FED_SYNTHETIC.json',s); self.assertTrue(self.errors())
    def test_unknown_enum_value_rejected(self):
        self.draft(); s=step(); s['applicability']={'op':'eq','fact':'citizenship_country','value':'undefined'}; self.put('federal/steps/FED_SYNTHETIC.json',s); self.assertTrue(self.errors())
    def test_overlay_version_mismatch_rejected(self):
        self.draft(); self.add_university(); o=overlay(); o['target_step_version']=2; self.put('universities/UNIV_SYNTHETIC/overlays/OVR_SYNTHETIC.json',o); self.assertTrue(self.errors())
    def test_missing_university_reference_rejected(self):
        self.draft(); self.add_university(); c=config(); c['overlay_ids']=[]; self.put('universities/UNIV_SYNTHETIC/university.json',c); self.assertTrue(self.errors())
    def test_unindexed_file_rejected(self):
        self.put('federal/steps/FED_SYNTHETIC.json',step()); self.assertTrue(self.errors())
    def test_invalid_timezone_rejected(self):
        self.draft(); s=step(); s['deadline']=relative_deadline(); s['deadline']['timezone']='Invalid/Timezone'; self.put('federal/steps/FED_SYNTHETIC.json',s); self.assertTrue(self.errors())
    def test_unknown_issue_rejected(self):
        self.draft(); s=step(); s['deadline']={'kind':'unknown','unresolved_ids':['UNR_MISSING']}; self.put('federal/steps/FED_SYNTHETIC.json',s); self.assertTrue(self.errors())
    def test_hour_offset_requires_precise_anchor(self):
        self.draft(); s=step(); d=relative_deadline(); d['anchor']={'kind':'fact','fact':'arrival_on'}; d['unit']='hour'; del d['time_of_day']; s['deadline']=d
        self.put('federal/steps/FED_SYNTHETIC.json',s); self.assertTrue(self.errors())
    def test_profile_trigger_cannot_supply_event_anchor(self):
        self.draft(); s=step(); s['trigger']={'kind':'profile','when':'initial','fields':['arrival_on']}; s['deadline']=relative_deadline(); self.put('federal/steps/FED_SYNTHETIC.json',s); self.assertTrue(self.errors())
    def test_inverted_period_rejected(self):
        self.draft(); s=step(); s['effective_period']={'from':'2000-02-01','through':'2000-01-01'}; self.put('federal/steps/FED_SYNTHETIC.json',s); self.assertTrue(self.errors())
    def test_false_release_rejected(self):
        m=self.read('manifest.json'); m['content_status']='released'; m['production_ready']=True; self.put('manifest.json',m); self.assertTrue(self.errors())
    def test_overlapping_scenario_expectations_rejected(self):
        self.draft(); s=scenario(); s['expected']['pending_step_ids']=['FED_SYNTHETIC']; self.put('tests/federal_scenarios.json',{'schema_version':'1.0.0','items':[s]}); self.assertTrue(self.errors())
    def test_duplicate_json_keys_rejected(self):
        (self.root/'manifest.json').write_text('{"schema_version":"1.0.0","schema_version":"1.0.0"}',encoding='utf-8')
        with self.assertRaises(ValueError): self.errors()
    def test_path_traversal_rejected(self):
        m=self.read('manifest.json'); m['federal_steps']=['../escape.json']; self.put('manifest.json',m); self.assertTrue(self.errors())

if __name__=='__main__': unittest.main(verbosity=2)
