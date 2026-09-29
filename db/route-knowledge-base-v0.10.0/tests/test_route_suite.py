"""Coverage, negative assertions and mutation sensitivity of the canonical suite."""
import copy, importlib.util, json, os, shutil, unittest, uuid
from pathlib import Path
R=Path(__file__).resolve().parents[1]
def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
r=module('canonical_route_tests',R/'integration/route_tests.py')
v=module('canonical_route_validator',R/'integration/validate.py')

class RouteSuiteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.suite=r.read(R/'tests/route_scenarios.json');cls.cases={c['id']:c for c in cls.suite['cases']}
        cls.configs,cls.steps,cls.overlays,_=r.inventory(R)
    def case(self,suffix):return copy.deepcopy(self.cases['TEST_ROUTE_'+suffix])
    def errors(self,c):return r.validate_suite(R,dict(self.suite,cases=[c]))
    def test_all_route_and_clock_cases(self):
        result=r.run_all(R);self.assertTrue(result['passed'],result)
    def test_every_real_step_has_positive_and_forbidden_coverage(self):
        for key in ['steps','forbidden_steps']:
            covered={s for c in self.suite['cases'] for s in c['expected'][key]}
            self.assertEqual(covered,set(self.steps),key)
    def test_every_overlay_has_a_positive_instance(self):
        self.assertEqual({o['overlay_id'] for c in self.suite['cases'] for o in c['expected']['overlays']},set(self.overlays))
    def test_all_university_steps_have_unknown_branch(self):
        covered={s for c in self.suite['cases'] for s in c['expected']['pending_steps']}
        self.assertTrue({s for s,v in self.steps.items() if v['kind']=='university'}<=covered)
    def test_required_scenario_families_present(self):
        tags={tag for c in self.suite['cases'] for tag in c['tags']}
        self.assertTrue({'before_arrival','after_arrival','visa','visa_free','citizenship','private_home','dormitory','hotel','inpatient','relatives',
                         'rvp','rvpo','vnh','move','reentry','documents_changed','itmo','unconfigured_university','ordering','unknown_data','conflict','future_event'}<=tags)
    def test_full_inventory_cases_assert_every_step(self):
        for c in self.suite['cases']:
            if 'full_inventory' in c['tags']:self.assertEqual(set(c['scope_step_ids']),set(self.steps))
    def test_no_real_partial_deadline_has_fabricated_date(self):
        for c in self.suite['cases']:
            for d in c['expected']['deadlines']:
                self.assertNotEqual(d['state'],'known')
                self.assertNotIn('at',d)
    def test_expected_forbidden_overlap_is_rejected(self):
        c=self.case('FLOW_ARRIVED');c['expected']['forbidden_steps'].append(c['expected']['steps'][0])
        self.assertTrue(any('overlapping' in e for e in self.errors(c)))
    def test_missing_forbidden_step_is_rejected(self):
        c=self.case('FLOW_ARRIVED');c['expected']['forbidden_steps'].pop()
        self.assertTrue(any('partition' in e for e in self.errors(c)))
    def test_missing_deadline_assertion_is_rejected(self):
        c=self.case('FLOW_ARRIVED');c['expected']['deadlines'].pop()
        self.assertTrue(any('missing base deadline' in e for e in self.errors(c)))
    def test_fabricated_exact_deadline_is_rejected(self):
        c=self.case('FLOW_ARRIVED');c['expected']['deadlines'][0].update(state='known',at='2026-10-01T12:00:00Z')
        self.assertTrue(any('fabricated calculable' in e for e in self.errors(c)))
    def test_wrong_deadline_layer_is_rejected(self):
        c=self.case('FLOW_ARRIVED');c['expected']['deadlines'][0]['layer']='university_internal'
        self.assertTrue(any('layer mismatch' in e for e in self.errors(c)))
    def test_missing_event_reference_is_rejected(self):
        c=self.case('FLOW_ARRIVED');c['expected']['instances'][0]['event_id']='MISSING'
        self.assertTrue(any('missing expected event' in e for e in self.errors(c)))
    def test_future_instance_is_rejected(self):
        c=self.case('FLOW_ARRIVED');c['events'][0]['occurred_at']='2026-10-01T00:00:00Z'
        self.assertTrue(any('future expected instance' in e for e in self.errors(c)))
    def test_duplicate_event_id_is_rejected(self):
        c=self.case('FLOW_ARRIVED');c['events'].append(copy.deepcopy(c['events'][0]))
        self.assertTrue(any('duplicate/reserved event' in e for e in self.errors(c)))
    def test_boolean_is_not_numeric_profile_flag(self):
        c=self.case('FLOW_ARRIVED');c['user_profile']['facts']['foreign_person']=1
        self.assertTrue(any('wrong fact type' in e for e in self.errors(c)))
    def test_foreign_local_fact_is_rejected_without_config(self):
        c=self.case('FLOW_UNCONFIGURED');c['user_profile']['facts']['itmo_current_student']=True
        self.assertTrue(any('unknown scoped fact' in e for e in self.errors(c)))
    def test_missing_config_is_explicit(self):
        c=self.case('FLOW_UNCONFIGURED');c['university']['state']='configured'
        self.assertTrue(any('missing configured' in e for e in self.errors(c)))
    def test_unconfigured_university_keeps_federal_route(self):
        c=self.case('FLOW_UNCONFIGURED');result=r.run_case(R,c)
        self.assertEqual(result['steps'],c['expected']['steps']);self.assertEqual(result['overlays'],[])
        self.assertFalse(any(s.startswith('UNI_') for s in result['steps']))
    def test_foreign_overlay_is_rejected(self):
        c=self.case('FLOW_ITMO_BEFORE');c['university']={'state':'not_selected'}
        self.assertTrue(any('foreign/wrong overlay' in e for e in self.errors(c)))
    def test_missing_required_order_is_rejected(self):
        c=self.case('FLOW_ITMO_EXPULSION_ORDER');c['expected']['ordering']['before']=[]
        self.assertTrue(any('dependency order' in e for e in self.errors(c)))
    def test_invented_order_is_rejected(self):
        c=self.case('FLOW_ARRIVED');c['expected']['ordering']['before']=[{'before_step_id':'FED_MEDICAL_INITIAL','after_step_id':'FED_MIGRATION_CARD_ENTRY'}]
        self.assertTrue(any('dependency order' in e for e in self.errors(c)))
    def test_repeat_entries_preserve_both_instance_deadlines(self):
        c=self.case('FLOW_REENTRY');result=r.run_case(R,c)
        self.assertEqual({(d['step_id'],d['event_id']) for d in result['deadlines']},{(i['step_id'],i['event_id']) for i in c['expected']['instances']})
        self.assertEqual(len(result['deadlines']),4)
    def test_card_mutation_creating_forbidden_action_is_detected(self):
        scratch=Path(os.environ.get('KB_TEST_SCRATCH',str(R.parent.parent/'work/tests'))).resolve();scratch.mkdir(parents=True,exist_ok=True)
        root=scratch/('route_mutation_'+uuid.uuid4().hex);shutil.copytree(R,root)
        try:
            p=root/'federal/steps/FED_HOST_DOCUMENTS.json';s=r.read(p);s['applicability']={'op':'always'};p.write_text(json.dumps(s),encoding='utf-8')
            c=self.case('FLOW_HOUSING_HOTEL');result=r.run_case(root,c)
            self.assertIn('FED_HOST_DOCUMENTS',set(result['steps']) & set(c['expected']['forbidden_steps']))
            self.assertNotEqual(r.normalized(result),r.normalized(c['expected']))
        finally:
            if root.resolve().parent!=scratch or not root.name.startswith('route_mutation_'):raise RuntimeError('Unsafe cleanup')
            shutil.rmtree(root)
    def test_synthetic_calendars_are_not_product_calendars(self):
        self.assertEqual(r.read(R/'dictionaries/calendars.json')['entries'],[])
        for c in r.read(R/'tests/deadline_cases.json')['cases']:self.assertTrue(c['synthetic'])
    def test_empty_user_profile_field_cannot_be_omitted(self):
        suite=copy.deepcopy(self.suite);suite['cases']=suite['cases'][:1];del suite['cases'][0]['user_profile']
        self.assertTrue(v.Contract(R).errors('route_test_suite.schema.json',suite))

if __name__=='__main__':unittest.main(verbosity=2)
