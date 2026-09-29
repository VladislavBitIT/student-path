"""ITMO integration boundaries, source/link coverage and non-mutation checks."""
import copy,hashlib,importlib.util,unittest
from pathlib import Path
R=Path(__file__).resolve().parents[1]
def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
a=module('itmo_audit',R/'integration/audit_scenarios.py');v=module('itmo_validation',R/'integration/validate.py')
B='universities/UNIV_ITMO/'

class ITMOTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest=a.read(R/'manifest.json');cls.config=a.read(R/(B+'university.json'))
        cls.overlays={o['id']:o for o in [a.read(R/p) for p in cls.manifest['universities'][0]['overlays']]}
        cls.cases={c['id']:c for c in a.read(R/'tests/university_scenarios.json')['items']}
        cls.coverage=a.read(R/(B+'research/federal_coverage.json'))
    def test_university_scenarios(self):
        result=a.run_all(R,'tests/university_scenarios.json');self.assertTrue(result['passed'],result['failures'])
    def test_federal_files_unchanged(self):
        current={p.relative_to(R).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in (R/'federal').rglob('*') if p.is_file()}
        self.assertEqual(current,self.coverage['federal_snapshot'])
    def test_every_federal_step_reviewed(self):
        rows=self.coverage['rows'];self.assertEqual(len(rows),len(self.manifest['federal_steps']))
        self.assertEqual({r['federal_step_id'] for r in rows},{Path(p).stem for p in self.manifest['federal_steps']})
        self.assertTrue(all(r['checked_source_ids'] and r['unresolved_ids'] for r in rows))
    def test_overlays_cannot_replace_federal_deadline(self):
        contract=v.Contract(R)
        for o in self.overlays.values():
            for field in ['deadline','applicability','depends_on']:
                changed=copy.deepcopy(o);changed['additions'][field]={'kind':'none','reason':'bad replacement'}
                self.assertTrue(contract.errors('university_overlay.schema.json',changed))
    def test_unresolved_dorm_owner_keeps_overlay_pending(self):
        result=a.run_case(R,self.cases['TEST_ITMO_UNKNOWN_DORM_OWNER'])
        self.assertEqual(result['pending_overlay_ids'],['OVR_ITMO_HOST_DOCUMENTS'])
        self.assertEqual(result['expected_shape']['included_step_ids'],['FED_HOST_DOCUMENTS'])
    def test_unknown_federal_basis_not_fixed_by_overlay(self):
        c=copy.deepcopy(self.cases['TEST_ITMO_OVERLAY_MEDICAL_INITIAL'])
        c['facts'].pop('medical_exam_required',None)
        for e in c['events']:e['facts'].pop('medical_exam_required',None)
        result=a.run_case(R,c)
        self.assertEqual(result['expected_shape']['pending_step_ids'],['FED_MEDICAL_INITIAL'])
        self.assertEqual(result['expected_shape']['applied_overlay_ids'],[])
    def test_internal_period_not_converted_to_federal_days(self):
        o=self.overlays['OVR_ITMO_STUDY_VISA_EXTEND'];local=o['additions']['local_deadlines'][0]
        self.assertIn('1,5',local['reported_text']);self.assertEqual(local['deadline']['kind'],'unknown')
        for o in self.overlays.values():
            for d in o['additions'].get('local_deadlines',[]):self.assertEqual(d['scope'],'university_internal')
    def test_all_new_sources_are_itmo(self):
        from urllib.parse import urlparse
        src={s['id']:s for s in a.read(R/'sources/sources.json')['items']}
        for s in src.values():
            if s['id'].startswith('SRC_ITMO_'):
                host=urlparse(s['url']).hostname
                self.assertTrue(host=='itmo.ru' or host.endswith('.itmo.ru'))
        for o in self.overlays.values():self.assertTrue(all(e['source_id'].startswith('SRC_ITMO_') for e in o['evidence']))
    def test_operational_urls_have_recorded_check(self):
        audit=a.read(R/(B+'research/link_audit.json'));checked={x['url'].rstrip('/') for x in audit['checks']}
        values=[self.config]+list(self.overlays.values())+[a.read(R/p) for p in self.manifest['universities'][0]['steps']]
        values += [s for s in a.read(R/'sources/sources.json')['items'] if s['id'].startswith('SRC_ITMO_')]
        for value in values:
            for node in v.walk(value):
                for key in ['url','information_url']:
                    if key in node:self.assertIn(node[key].rstrip('/'),checked)
                if node.get('kind')=='url':self.assertIn(node['value'].rstrip('/'),checked)
    def test_portal_login_not_called_verified_submission(self):
        checks=a.read(R/(B+'research/link_audit.json'))['checks']
        self.assertEqual(next(x for x in checks if x['url']=='https://my.itmo.ru/requests')['result'],'login_redirect')
        self.assertEqual(next(x for x in checks if x['url']=='https://my.itmo.ru/requests/new/8326')['result'],'tool_unavailable')
    def test_paid_document_condition_is_preserved(self):
        doc=self.overlays['OVR_ITMO_HOST_DOCUMENTS']['additions']['documents'][0]
        self.assertFalse(a.evaluate(doc['condition'],{'itmo_paid_education':False}))
        self.assertIsNone(a.evaluate(doc['condition'],{}))
    def test_all_university_actions_keep_internal_scope(self):
        for path in self.manifest['universities'][0]['steps']:
            s=a.read(R/path);self.assertEqual(s['obligation_scope'],'university_internal');self.assertEqual(s['status'],'draft')
        self.assertFalse(self.manifest['production_ready'])

if __name__=='__main__':unittest.main(verbosity=2)
