"""Data and integration boundaries of the authored federal cards; no legal certification."""
import copy,importlib.util,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('federal_validator',ROOT/'integration/validate.py')
v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)

def condition(expr,profile):
    op=expr['op']
    if op=='always':return True
    if op=='all':
        xs=[condition(x,profile) for x in expr['args']]
        return False if False in xs else (None if None in xs else True)
    if op=='any':
        xs=[condition(x,profile) for x in expr['args']]
        return True if True in xs else (None if None in xs else False)
    if op=='not':
        x=condition(expr['arg'],profile);return None if x is None else not x
    if op=='exists':return expr['fact'] in profile
    if expr['fact'] not in profile:return None
    a=profile[expr['fact']]
    if op=='in':return a in expr['values']
    if op=='not_in':return a not in expr['values']
    b=expr['value']
    return {'eq':lambda:a==b,'ne':lambda:a!=b,'gt':lambda:a>b,'gte':lambda:a>=b,'lt':lambda:a<b,'lte':lambda:a<=b}[op]()

class FederalLayerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.contract=v.Contract(ROOT);cls.manifest=v.strict_json(ROOT/'manifest.json')
        cls.steps={s['id']:s for s in (v.strict_json(ROOT/p) for p in cls.manifest['federal_steps'])}
    def test_manifest_and_all_json_validate(self):
        errors,summary=v.validate_package(ROOT)
        self.assertEqual(errors,[]);self.assertGreater(summary['federal_step_count'],0)
    def test_new_cards_require_field_provenance(self):
        s=copy.deepcopy(self.steps['FED_STUDY_VISA_EXTEND'])
        del s['evidence'][0]['fields']
        self.assertTrue(self.contract.errors('federal_step.schema.json',s))
    def test_partial_deadline_cannot_be_calculated(self):
        d=copy.deepcopy(self.steps['FED_MEDICAL_INITIAL']['deadline']);d['calculation_allowed']=True
        self.assertTrue(self.contract.errors('deadline.schema.json',d))
    def test_medical_pre_september_entry_not_auto_routed(self):
        p={'foreign_person':True,'medical_exam_required':True,'residence_status':'temporary_stay','planned_stay_days':365,'non_work_entry':True,'entry_on':'2026-08-31'}
        self.assertFalse(condition(self.steps['FED_MEDICAL_INITIAL']['applicability'],p))
        p['entry_on']='2026-09-01';self.assertTrue(condition(self.steps['FED_MEDICAL_INITIAL']['applicability'],p))
    def test_missing_legal_exception_check_remains_unknown(self):
        p={'foreign_person':True,'residence_status':'temporary_stay','planned_stay_days':365,'non_work_entry':True,'entry_on':'2026-09-01'}
        self.assertIsNone(condition(self.steps['FED_MEDICAL_INITIAL']['applicability'],p))
    def test_rvpo_not_assigned_ordinary_annual_notice(self):
        p={'foreign_person':True,'residence_status':'rvpo','annual_notice_required':True}
        for sid in ['FED_VNH_ANNUAL_NOTICE','FED_RVP_ANNUAL_NOTICE']:
            self.assertFalse(condition(self.steps[sid]['applicability'],p))
    def test_ruID_emergency_variants_do_not_overlap(self):
        p={'foreign_person':True,'visa_free_entry':True,'ruid_applicable':True,'emergency_entry':False}
        self.assertTrue(condition(self.steps['FED_RUID_STANDARD']['applicability'],p))
        self.assertFalse(condition(self.steps['FED_RUID_EMERGENCY']['applicability'],p))
        del p['emergency_entry']
        self.assertIsNone(condition(self.steps['FED_RUID_STANDARD']['applicability'],p))
        self.assertIsNone(condition(self.steps['FED_RUID_EMERGENCY']['applicability'],p))
    def test_institutional_deadlines_not_given_to_student(self):
        for s in self.steps.values():
            self.assertEqual(s['actor'],'student')
            if s['deadline']['kind']=='partial':self.assertEqual(s['deadline']['known']['actor'],'student')
        self.assertEqual(self.steps['FED_HOST_DOCUMENTS']['deadline']['kind'],'unknown')
        self.assertEqual(self.steps['FED_STAY_PETITION_REQUEST']['deadline']['kind'],'unknown')
    def test_unsupported_project_not_promoted(self):
        self.assertNotIn('FED_RVPO_TRANSFER_NOTICE',self.steps)
    def test_existing_snils_not_registered_again(self):
        p={'foreign_person':True,'age_years':20,'needs_snils':True,'has_snils':True}
        self.assertFalse(condition(self.steps['FED_SNILS_REGISTER']['applicability'],p))

if __name__=='__main__':unittest.main(verbosity=2)
