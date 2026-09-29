"""One offline acceptance command: schema, legacy and canonical scenarios, unit tests."""
import argparse, importlib.util, json, sys, unittest
from pathlib import Path
def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def run(root):
    root=Path(root).resolve();integration=root/'integration'
    validate=module('acceptance_validate',integration/'validate.py')
    try:errors,summary=validate.validate_package(root)
    except Exception as exc:return {'passed':False,'schema_errors':[str(exc)]}
    if errors:return {'passed':False,'summary':summary,'schema_errors':errors}
    audit=module('acceptance_audit',integration/'audit_scenarios.py')
    route=module('acceptance_route',integration/'route_tests.py')
    legacy=[audit.run_all(root,p) for p in ['tests/federal_scenarios.json','tests/university_scenarios.json']]
    canonical=route.run_all(root)
    quality=module('acceptance_quality',integration/'quality_checks.py').run(root)
    suite=unittest.defaultTestLoader.discover(str(root/'tests'))
    tests=unittest.TextTestRunner(verbosity=1,stream=sys.stderr).run(suite)
    return {'passed':tests.wasSuccessful() and canonical['passed'] and quality['passed'] and all(x['passed'] for x in legacy),'summary':summary,
        'quality_invariants':{'passed':quality['passed'],'errors':quality['errors'],'satisfiable_conditions':sum(x['state']=='satisfiable' for x in quality['conditions'])},
        'schema_errors':errors,'technical_tests_run':tests.testsRun,'technical_failures':len(tests.failures),'technical_errors':len(tests.errors),
        'legacy_scenarios':{'federal':legacy[0]['case_count'],'university':legacy[1]['case_count'],'failures':[f for x in legacy for f in x['failures']]},
        'canonical_scenarios':canonical}
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1]);parser.add_argument('--output',type=Path)
    args=parser.parse_args();result=run(args.root);text=json.dumps(result,ensure_ascii=False,indent=2)+'\n'
    if args.output:args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(text,encoding='utf-8')
    print(text);sys.exit(0 if result['passed'] else 1)
