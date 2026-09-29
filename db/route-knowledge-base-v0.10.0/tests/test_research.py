"""Research integrity tests; do not certify legal truth or completeness."""
import copy
import importlib.util
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('research_validator',ROOT/'integration/validate.py')
v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)

class ResearchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.contract=v.Contract(ROOT)
        cls.map=v.strict_json(ROOT/'federal/research/process_map.json')
        cls.sources=v.strict_json(ROOT/'sources/sources.json')['items']
    def test_package_integrity(self):
        errors,summary=v.validate_package(ROOT)
        self.assertEqual(errors,[])
        self.assertEqual(summary['federal_step_count'],len(v.strict_json(ROOT/'manifest.json')['federal_steps']))
        self.assertFalse(summary['production_ready'])
        self.assertEqual(summary['research_process_count'],len(self.map['items']))
    def test_partial_claim_requires_gap(self):
        claim=copy.deepcopy(self.map['items'][0]['applicability'])
        claim['unresolved_ids']=[]
        self.assertTrue(self.contract.errors('research_claim.schema.json',claim))
    def test_documented_claim_requires_evidence(self):
        claim={'state':'documented','text':'Synthetic claim','evidence':[],'unresolved_ids':[]}
        self.assertTrue(self.contract.errors('research_claim.schema.json',claim))
    def test_research_cannot_be_marked_operational(self):
        process=copy.deepcopy(self.map['items'][0]);process['operational']=True
        self.assertTrue(self.contract.errors('research_process.schema.json',process))
    def test_research_deadline_not_executable(self):
        process=copy.deepcopy(self.map['items'][0]);process['deadlines'][0]['calculation_ready']=True
        self.assertTrue(self.contract.errors('research_process.schema.json',process))
    def test_new_medical_deadline_does_not_replace_fingerprint(self):
        byid={p['id']:p for p in self.map['items']}
        medical=byid['PROC_MED_INITIAL']['deadlines'][0]
        fingerprint=byid['PROC_FINGERPRINT']['deadlines'][0]
        self.assertEqual((medical['amount'],medical['unit']),(30,'calendar_day'))
        self.assertEqual(fingerprint['description']['state'],'partial')
        self.assertNotEqual(medical['amount'],fingerprint['amount'])
    def test_every_source_has_audit_entry(self):
        entries=v.strict_json(ROOT/'sources/research_audit.json')['entries']
        self.assertEqual({x['source_id'] for x in entries},{x['id'] for x in self.sources})
    def test_all_uncertain_claims_point_to_registered_gaps(self):
        gaps={x['id'] for x in v.strict_json(ROOT/'unresolved/unresolved.json')['items']}
        for node in v.walk(self.map):
            if node.get('state') in ['partial','unknown']:
                self.assertTrue(node['unresolved_ids'])
                self.assertTrue(set(node['unresolved_ids']) <= gaps)

if __name__=='__main__':unittest.main(verbosity=2)
