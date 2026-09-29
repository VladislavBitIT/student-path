"""Synthetic universities exist only in temporary test copies, never in product data."""
import copy, hashlib, importlib.util, json, os, shutil, unittest, uuid
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
v=module('scalability_validator',ROOT/'integration/validate.py')
a=module('scalability_audit',ROOT/'integration/audit_scenarios.py')
EVIDENCE=[{'source_id':'SRC_TEST_ARCHITECTURE','locator':'Synthetic fixture','supports':'Test only; no real university requirement'}]

class ScalabilityTests(unittest.TestCase):
    def setUp(self):
        self.scratch=Path(os.environ.get('KB_TEST_SCRATCH',str(ROOT.parent.parent/'work/tests'))).resolve()
        self.scratch.mkdir(parents=True,exist_ok=True)
        self.root=self.scratch/('scale_'+uuid.uuid4().hex);shutil.copytree(ROOT,self.root)
        self.before=self.core_hashes()
        sources=self.read('sources/sources.json');sources['items'].append({
            'schema_version':'1.0.0','id':'SRC_TEST_ARCHITECTURE','kind':'university_guidance',
            'title':'Fictional fixture, not a real source','publisher':'Synthetic university',
            'url':'https://example.invalid','jurisdiction':'Synthetic','language':'ru',
            'retrieved_at':'2026-09-26T00:00:00Z','verification_status':'unverified'})
        self.put('sources/sources.json',sources)
        audit=self.read('sources/research_audit.json');audit['entries'].append({
            'source_id':'SRC_TEST_ARCHITECTURE','access':'unavailable','authority':'university',
            'temporal_limit':'Synthetic only','permitted_use':'Test fixture only','trace_files':[]})
        self.put('sources/research_audit.json',audit)
        self.add_university('SECOND')
    def tearDown(self):
        if self.root.resolve().parent!=self.scratch or not self.root.name.startswith('scale_'):raise RuntimeError('Unsafe cleanup')
        shutil.rmtree(self.root)
    def read(self,p):return json.loads((self.root/p).read_text(encoding='utf-8'))
    def put(self,p,d):
        p=self.root/p;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    def core_hashes(self):
        return {p.relative_to(self.root).as_posix():hashlib.sha256(p.read_bytes()).hexdigest()
                for area in ['federal','dictionaries','schemas','integration'] for p in (self.root/area).rglob('*') if p.is_file()}
    def add_university(self,name,values=('north','south')):
        uid='UNIV_'+name;b='universities/'+uid+'/';d=b+'dictionaries/'
        facts={'schema_version':'1.0.0','id':'facts','entries':[{'code':'campus_code','label':'Fictional campus','type':'enum','dictionary_id':'campuses'}]}
        events={'schema_version':'1.0.0','id':'event_types','status':'maintained','description':'Synthetic events','entries':[{'code':'local_enrolment','label':'Synthetic local event'}]}
        enums={'schema_version':'1.0.0','id':'campuses','status':'maintained','description':'Synthetic campuses','entries':[{'code':x,'label':x} for x in values]}
        calendars={'schema_version':'1.0.0','id':'calendars','entries':[{
            'code':'local_office','timezone':'Asia/Vladivostok','coverage_start':'2026-01-01','coverage_end':'2026-12-31',
            'weekend_days':[5,6],'working_dates':[],'non_working_dates':[],'evidence':EVIDENCE}]}
        cfg={'schema_version':'1.1.0','id':uid,'name':'Fictional '+name,'status':'draft','timezone':'Asia/Vladivostok',
             'contacts':[],'overlay_ids':[],'step_ids':['UNI_'+name+'_LOCAL'],'evidence':[],
             'extension_resources':{'facts':d+'facts.json','event_types':d+'event_types.json','calendars':d+'calendars.json','dictionaries':[d+'campuses.json']}}
        m=self.read('manifest.json');entry={'config':b+'university.json','overlays':[],'steps':[b+'steps/UNI_'+name+'_LOCAL.json']}
        for data,schema in [(facts,'fact_dictionary'),(events,'dictionary'),(enums,'dictionary'),(calendars,'calendar_dictionary')]:
            path=d+data['id']+'.json';self.put(path,data);m['resources'].append({'path':path,'schema':'schemas/'+schema+'.schema.json'})
        for index,value in enumerate(values):
            oid='OVR_'+name+'_'+str(index);path=b+'overlays/'+oid+'.json'
            o={'schema_version':'1.1.0','id':oid,'university_id':uid,'target_step_id':'FED_INVITATION_REQUEST',
               'target_step_version':self.read('federal/steps/FED_INVITATION_REQUEST.json')['version'],'version':1,'status':'draft',
               'applicability':{'op':'eq','fact':'campus_code','value':value},'effective_period':{'from':'2026-01-01','through':'2026-12-31'},
               'additions':{'instructions':['Synthetic action for '+value], 'local_deadlines':[{
                   'id':'LOCAL_PERIOD','scope':'university_internal','title':'Synthetic submission window','applicability':{'op':'always'},
                   'reported_text':'Synthetic 2 office working days after event','state':'confirmed',
                   'deadline':{'kind':'relative','anchor':{'kind':'trigger_event'},'amount':2,'unit':'business_day','direction':'after',
                       'include_anchor_day':False,'time_of_day':'12:00:00','timezone':'Asia/Vladivostok','rollover':'none','month_end':'clamp','calendar_ref':'local_office'},
                   'source_id':'SRC_TEST_ARCHITECTURE','locator':'Synthetic fixture','checked_on':'2026-09-26'}]},
               'evidence':[dict(EVIDENCE[0],fields=['/additions'],checked_on='2026-09-26',support_level='direct')],
               'unresolved_ids':[],'review':{'reviewed_at':'2026-09-26T00:00:00Z','reviewer':'Synthetic test','next_review_on':'2026-12-31'}}
            self.put(path,o);entry['overlays'].append(path);cfg['overlay_ids'].append(oid)
        step={'schema_version':'1.0.0','id':'UNI_'+name+'_LOCAL','university_id':uid,'kind':'university','version':1,'status':'draft',
              'title':'Synthetic university action','summary':'Test only','applicability':{'op':'always'},
              'trigger':{'kind':'event','event_type':'local_enrolment','occurrence':'each','where':{'op':'always'}},
              'deadline':{'kind':'none','reason':'Synthetic'},'instructions':['Synthetic action'],'documents':[],
              'destination':{'kind':'none','reason':'Synthetic'},'result':{'title':'Synthetic result','completion_mode':'user_confirmation'},
              'warnings':[],'depends_on':[],'effective_period':{},'evidence':EVIDENCE,'unresolved_ids':[]}
        self.put(entry['steps'][0],step);self.put(entry['config'],cfg);m['universities'].append(entry);self.put('manifest.json',m)
    def case(self,uid='UNIV_SECOND',campus='north'):
        c=copy.deepcopy(self.read('tests/university_scenarios.json')['items'][0]);c['university_id']=uid
        if campus is not None:
            c['facts']['campus_code']=campus
            for e in c['events']:e['facts']['campus_code']=campus
        return c
    def overlay_path(self):return 'universities/UNIV_SECOND/overlays/OVR_SECOND_0.json'
    def errors(self):return v.validate_package(self.root)[0]
    def test_second_university_is_data_only(self):
        self.assertEqual(self.errors(),[]);self.assertEqual(self.before,self.core_hashes())
        self.assertTrue(a.run_all(self.root)['passed']);self.assertTrue(a.run_all(self.root,'tests/university_scenarios.json')['passed'])
    def test_campus_variants_and_composition_keep_federal(self):
        for campus,oid in [('north','OVR_SECOND_0'),('south','OVR_SECOND_1')]:
            result=a.run_case(self.root,self.case(campus=campus));self.assertEqual(result['expected_shape']['applied_overlay_ids'],[oid])
            view=result['composed_instances'][0];base=self.read('federal/steps/FED_INVITATION_REQUEST.json')
            self.assertEqual(view['federal'],base);view['university_additions']['instructions'].append('Changed in memory')
            self.assertEqual(self.read('federal/steps/FED_INVITATION_REQUEST.json'),base)
            self.assertEqual(result['executable_step_ids'],[])
    def test_missing_campus_preserves_base_pending_overlay(self):
        result=a.run_case(self.root,self.case(campus=None))
        self.assertEqual(result['pending_overlay_ids'],['OVR_SECOND_0','OVR_SECOND_1'])
        self.assertEqual(result['expected_shape']['included_step_ids'],['FED_INVITATION_REQUEST'])
    def test_two_matching_overlays_fail_explicitly(self):
        p='universities/UNIV_SECOND/overlays/OVR_SECOND_1.json';o=self.read(p);o['applicability']={'op':'always'};self.put(p,o)
        with self.assertRaisesRegex(ValueError,'Conflicting overlays'):a.run_case(self.root,self.case())
    def test_expired_and_retired_overlays_excluded(self):
        p=self.overlay_path();original=self.read(p)
        for field,value in [('effective_period',{'through':'2026-08-31'}),('status','retired')]:
            o=copy.deepcopy(original);o[field]=value;self.put(p,o)
            self.assertEqual(a.run_case(self.root,self.case())['expected_shape']['applied_overlay_ids'],[])
    def test_effective_period_uses_utc(self):
        self.assertTrue(a.active_on({'effective_period':{'through':'2026-09-25'}},'2026-09-26T01:00:00+03:00'))
    def test_retired_config_disables_its_overlays(self):
        p='universities/UNIV_SECOND/university.json';c=self.read(p);c['status']='retired';self.put(p,c)
        self.assertEqual(a.run_case(self.root,self.case())['expected_shape']['applied_overlay_ids'],[])
    def test_unknown_university_fails(self):
        with self.assertRaisesRegex(ValueError,'Unknown university'):a.run_case(self.root,self.case(uid='UNIV_MISSING'))
    def test_foreign_local_facts_and_events_rejected(self):
        c=self.case();c['facts']['itmo_paid_education']=True
        with self.assertRaisesRegex(ValueError,'Facts outside'):a.run_case(self.root,c)
        c=self.case();c['events'][0]['event_type']='itmo_dorm_requested'
        with self.assertRaisesRegex(ValueError,'Events outside'):a.run_case(self.root,c)
    def test_new_local_event_and_step(self):
        c=self.case();c['scope_step_ids']=['UNI_SECOND_LOCAL'];c['events'][0]['event_type']='local_enrolment'
        self.assertEqual(a.run_case(self.root,c)['expected_shape']['included_step_ids'],['UNI_SECOND_LOCAL'])
    def test_local_enum_names_can_repeat_between_universities(self):
        self.add_university('THIRD',('remote','central'));self.assertEqual(self.errors(),[])
        self.assertEqual(a.run_case(self.root,self.case('UNIV_THIRD','remote'))['expected_shape']['applied_overlay_ids'],['OVR_THIRD_0'])
    def test_federal_cannot_use_local_fact_or_event_or_calendar(self):
        p='federal/steps/FED_INVITATION_REQUEST.json';base=self.read(p)
        for field,value in [('applicability',{'op':'eq','fact':'campus_code','value':'north'}),
                            ('trigger',{'kind':'event','event_type':'local_enrolment','occurrence':'each','where':{'op':'always'}}),
                            ('deadline',self.read(self.overlay_path())['additions']['local_deadlines'][0]['deadline'])]:
            s=copy.deepcopy(base);s[field]=value;self.put(p,s)
            self.assertTrue(any('unknown' in e for e in self.errors()),self.errors())
    def test_local_cannot_shadow_core_fact(self):
        p='universities/UNIV_SECOND/dictionaries/facts.json';d=self.read(p);d['entries'].append({'code':'foreign_person','type':'boolean','label':'Bad shadow'});self.put(p,d)
        self.assertTrue(any('shadow core' in e for e in self.errors()))
    def test_cross_university_resource_rejected(self):
        p='universities/UNIV_SECOND/university.json';d=self.read(p);d['extension_resources']['facts']='universities/UNIV_ITMO/dictionaries/facts.json';self.put(p,d)
        self.assertTrue(any('Foreign university resource' in e for e in self.errors()))
    def test_unclaimed_dictionary_rejected(self):
        p='universities/UNIV_SECOND/university.json';d=self.read(p);d['extension_resources']['dictionaries']=[];self.put(p,d)
        self.assertTrue(any('Unclaimed dictionary' in e for e in self.errors()))
    def test_wrong_local_enum_value_rejected(self):
        p=self.overlay_path();o=self.read(p);o['applicability']['value']='missing';self.put(p,o)
        self.assertTrue(any('undefined value' in e for e in self.errors()))
    def test_confirmed_local_deadline_requires_complete_model(self):
        o=self.read(self.overlay_path());o['additions']['local_deadlines'][0]['deadline']={'kind':'unknown','unresolved_ids':['UNR_SYNTHETIC']}
        self.assertTrue(v.Contract(self.root).errors('university_overlay.schema.json',o))
    def test_local_calendar_timezone_mismatch_rejected(self):
        p=self.overlay_path();o=self.read(p);o['additions']['local_deadlines'][0]['deadline']['timezone']='Europe/Moscow';self.put(p,o)
        self.assertTrue(any('calendar/deadline timezone mismatch' in e for e in self.errors()))
    def test_federal_cannot_cite_university_guidance(self):
        p='federal/steps/FED_INVITATION_REQUEST.json';s=self.read(p);s['evidence'][0]['source_id']='SRC_TEST_ARCHITECTURE';self.put(p,s)
        self.assertTrue(any('federal step cites university' in e for e in self.errors()))
    def test_core_has_no_itmo_literals(self):
        for area in ['federal','dictionaries','schemas','integration']:
            for p in (ROOT/area).rglob('*'):
                if p.suffix not in ['.json','.py']:continue
                text=p.read_text(encoding='utf-8').lower()
                self.assertNotIn('itmo',text,str(p));self.assertNotIn('итмо',text,str(p))

if __name__=='__main__':unittest.main(verbosity=2)
