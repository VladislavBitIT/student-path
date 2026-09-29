"""Regression checks for audited data, event history and draft isolation."""
import copy,importlib.util,unittest
from pathlib import Path
R=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('profile_audit',R/'integration/audit_scenarios.py')
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
spec=importlib.util.spec_from_file_location('profile_validate',R/'integration/validate.py')
v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)

class ProfileAuditTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cases={c['id']:c for c in a.read(R/'tests/federal_scenarios.json')['items']}
        cls.steps={s['id']:s for s in [a.read(R/p) for p in a.read(R/'manifest.json')['federal_steps']]}
    def test_all_authored_scenarios(self):
        result=a.run_all(R);self.assertTrue(result['passed'],result['failures'])
    def test_every_card_has_positive_and_negative_coverage(self):
        for state in ['included','excluded']:
            covered={s for c in self.cases.values() for s in c['expected'][state+'_step_ids']}
            self.assertEqual(covered,set(self.steps))
    def test_unknown_is_not_false(self):
        for op in ['eq','ne','in','not_in']:
            expr={'op':op,'fact':'citizenship_country'}
            expr['values' if op in ['in','not_in'] else 'value']=['by'] if op in ['in','not_in'] else 'by'
            self.assertIsNone(a.evaluate(expr,{}))
    def test_no_audit_result_is_executable(self):
        for c in self.cases.values():self.assertEqual(a.run_case(R,c)['executable_step_ids'],[])
        self.assertFalse(a.read(R/'manifest.json')['production_ready'])
        self.assertTrue(all(s['status']=='draft' for s in self.steps.values()))
    def test_context_reset_preserves_permanent_facts(self):
        c=copy.deepcopy(self.cases['TEST_AUDIT_REENTRY_STALE_MED']);c['facts'].update(has_snils=True,inn_assigned=True,fingerprint_completed=True)
        reset={x['fact'] for x in a.run_case(R,c)['invalidated']}
        self.assertIn('medical_exam_required',reset)
        self.assertFalse(reset & {'has_snils','inn_assigned','fingerprint_completed'})
    def test_new_event_can_supply_fresh_confirmation(self):
        c=copy.deepcopy(self.cases['TEST_AUDIT_REENTRY_STALE_MED']);c['events'][0]['facts']['medical_exam_required']=True
        actual=a.run_case(R,c)
        self.assertEqual(actual['expected_shape']['included_step_ids'],['FED_MEDICAL_INITIAL'])
    def test_duplicate_entries_not_collapsed(self):
        actual=a.run_case(R,self.cases['TEST_AUDIT_REENTRY_TWO'])
        self.assertEqual({i['event_id'] for i in actual['instances']},{'ENTRY1','ENTRY2'})
    def test_scenario_scope_is_explicit(self):
        c=copy.deepcopy(next(iter(self.cases.values())));del c['scope_step_ids']
        self.assertTrue(v.Contract(R).errors('test_scenario.schema.json',c))
    def test_comparative_treaty_periods_are_not_deadlines(self):
        report=a.read(R/'federal/audit/profile_audit.json')
        self.assertTrue(all(x['operational'] is False for x in report['country_comparisons']))
        self.assertEqual(self.steps['FED_HOST_DOCUMENTS']['deadline']['kind'],'unknown')
    def test_partial_deadline_has_no_exact_timestamp(self):
        actual=a.run_case(R,self.cases['TEST_AUDIT_MED_91_DAYS'])
        self.assertEqual(actual['expected_shape']['deadlines'],[{'step_id':'FED_MEDICAL_INITIAL','state':'unknown'}])
    def test_audit_sources_and_json_validate(self):
        errors,summary=v.validate_package(R);self.assertEqual(errors,[])
        self.assertEqual(summary['scenario_count'],len(self.cases)+len(a.read(R/'tests/university_scenarios.json')['items']))

if __name__=='__main__':unittest.main(verbosity=2)
