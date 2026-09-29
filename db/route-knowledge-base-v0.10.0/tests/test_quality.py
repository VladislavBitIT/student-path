"""Regressions for quality findings; no network and no claim of legal validation."""
import copy,importlib.util,json,unittest
from pathlib import Path
R=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('test_quality_engine',R/'integration/quality_checks.py')
q=importlib.util.module_from_spec(spec);spec.loader.exec_module(q)

class QualityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.scopes,_,cls.steps,cls.overlays,_=q.a.load_package(R)
    def solve(self,expr,limit=100000):
        facts,_,_=q.a.vocabulary.tables(self.scopes[None]);return q.possible(expr,facts,self.scopes[None],limit)
    def test_contradictory_condition_detected(self):
        self.assertEqual(self.solve({'op':'all','args':[{'op':'eq','fact':'foreign_person','value':True},{'op':'eq','fact':'foreign_person','value':False}]})['state'],'unsatisfiable')
    def test_missing_field_exists_branch(self):
        self.assertEqual(self.solve({'op':'not','arg':{'op':'exists','fact':'foreign_person'}})['state'],'satisfiable')
    def test_search_limit_is_not_proof(self):
        self.assertEqual(self.solve({'op':'eq','fact':'foreign_person','value':True},1)['state'],'indeterminate')
    def test_overlapping_duplicate_detected(self):
        steps=copy.deepcopy(self.steps);duplicate=copy.deepcopy(steps['FED_ENTRY_RULE_CHECK']);duplicate['id']='FED_DUPLICATE';steps[duplicate['id']]=duplicate
        errors,_=q.audit_objects(steps,self.overlays,self.scopes)
        self.assertTrue(any('Duplicate overlapping' in e for e in errors))
    def test_disjoint_variants_are_not_duplicates(self):
        errors,_=q.audit_objects(self.steps,self.overlays,self.scopes);self.assertFalse(errors,errors)
    def test_overlay_contradiction_detected(self):
        overlays=copy.deepcopy(self.overlays);overlays[0]['applicability']={'op':'eq','fact':'foreign_person','value':False}
        errors,_=q.audit_objects(self.steps,overlays,self.scopes)
        self.assertTrue(any('overlay conflicts' in e for e in errors))
    def test_historical_deadlines_are_unknown(self):
        for sid in ['FED_RUID_STANDARD','FED_RUID_EMERGENCY','FED_FINGERPRINT_PHOTO']:
            self.assertEqual(self.steps[sid]['deadline']['kind'],'unknown')
    def test_remote_action_does_not_require_original(self):
        for sid in ['FED_ENTRY_RULE_CHECK','FED_INVITATION_REQUEST','FED_RUID_STANDARD','FED_RUID_EMERGENCY','FED_RKL_CHECK','FED_RETURN_VISA_CHECK']:
            self.assertEqual(self.steps[sid]['documents'][0]['form'],'unspecified')
        self.assertEqual(self.steps['FED_VISA_COLLECT_ABROAD']['documents'],[])
    def test_complete_quality_index(self):
        result=q.run(R);self.assertTrue(result['passed'],result['errors']);self.assertEqual(len(result['conditions']),len(self.steps)+len(self.overlays))
    def test_access_and_legal_truth_remain_separate(self):
        report=q.a.read(R/'sources/quality_audit.json')
        self.assertEqual(report['decision'],'content_blocked')
        self.assertTrue(any(x['state']=='tool_unavailable' for x in report['links']))
        self.assertEqual(report['languages']['en'],'not_provided')
        self.assertFalse(q.a.read(R/'manifest.json')['production_ready'])

if __name__=='__main__':unittest.main()
