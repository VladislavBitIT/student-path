#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
errors: list[str] = []
warnings: list[str] = []


def read_json(rel: str):
    path = ROOT / rel
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except Exception as exc:
        errors.append(f'{rel}: JSON read failed: {exc}')
        return {}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


requirements = read_json('import/university_requirements.json').get('items', [])
universities = read_json('import/universities.json').get('items', [])
sources = read_json('audit/source_registry.json').get('items', [])
links = read_json('audit/link_audit.json').get('items', [])
embedded = read_json('audit/validation_report.json')

if len(requirements) != 122:
    errors.append(f'Expected 122 cards, got {len(requirements)}')
if len(universities) != 10:
    errors.append(f'Expected 10 universities, got {len(universities)}')
if embedded.get('valid') is not True:
    errors.append('Embedded validation report is not valid')

card_ids = [x.get('id') for x in requirements]
if len(card_ids) != len(set(card_ids)):
    errors.append('Duplicate card IDs')
source_map = {x.get('source_id'): x for x in sources}
link_map = {x.get('url'): x for x in links}
if len(source_map) != len(sources):
    errors.append('Duplicate source IDs')
if len(link_map) != len(links):
    errors.append('Duplicate link-audit URLs')

actual_source_usage = Counter()
trace_paths = set()
for card in requirements:
    cid = card.get('id', '<missing-id>')
    if not card.get('actions'):
        errors.append(f'{cid}: no actions')
    if not card.get('sources'):
        errors.append(f'{cid}: no sources')
    deadline = card.get('deadline') or {}
    if not deadline.get('kind') or not deadline.get('display_text'):
        errors.append(f'{cid}: missing deadline semantics')
    if deadline.get('reminder_eligible') and not deadline.get('machine_rule') and deadline.get('kind') != 'contract_defined':
        errors.append(f'{cid}: reminder enabled without machine_rule')
    if not deadline.get('reminder_eligible') and not card.get('fallback'):
        errors.append(f'{cid}: non-reminder rule has no fallback')
    verification = card.get('verification') or {}
    if verification.get('unhandled_gap'):
        errors.append(f'{cid}: unhandled gap')
    if verification.get('route_safe') is not True:
        errors.append(f'{cid}: route_safe != true')
    exclusion_text = ' | '.join(verification.get('excluded_claims') or [])
    if deadline.get('reminder_eligible') and re.search(r'не использ[^.]{0,120}автоматическ[^.]{0,40}напомин', exclusion_text, re.I):
        errors.append(f'{cid}: reminder contradicts exclusion')
    if verification.get('status') == 'confirmed_campaign_2026' and not card.get('do_not_extrapolate'):
        errors.append(f'{cid}: campaign card lacks do_not_extrapolate')
    active = json.dumps({k: v for k, v in card.items() if k not in {'verification', 'traceability'}}, ensure_ascii=False)
    if re.search(r'(?<!\\d)1[\\s\\u00a0]?600\\s*(?:₽|руб)', active, re.I):
        errors.append(f'{cid}: stale 1 600 fee in active fields')
    if re.search(r'(?<!\\d)1[\\s\\u00a0]?920\\s*(?:₽|руб)', active, re.I):
        errors.append(f'{cid}: stale 1 920 fee in active fields')
    safe_evidence = False
    for src in card.get('sources') or []:
        sid = src.get('source_id')
        url = src.get('verified_url')
        actual_source_usage[sid] += 1
        if sid not in source_map:
            errors.append(f'{cid}: missing source registry record {sid}')
            continue
        if not url:
            errors.append(f'{cid}: source {sid} lacks verified_url')
            continue
        if source_map[sid].get('verified_url') != url:
            errors.append(f'{cid}: source URL mismatch for {sid}')
        link = link_map.get(url)
        if not link:
            errors.append(f'{cid}: URL absent from link audit: {url}')
            continue
        if not link.get('safe_for_user_link'):
            errors.append(f'{cid}: unsafe user link: {url}')
        safe_evidence = safe_evidence or bool(link.get('safe_as_sole_evidence'))
    if not safe_evidence:
        errors.append(f'{cid}: no readable verified evidence source')
    trace = (card.get('traceability') or {}).get('original_path')
    if trace:
        trace_paths.add(trace)

for sid, count in actual_source_usage.items():
    if sid in source_map and source_map[sid].get('used_by_active_cards') != count:
        errors.append(f'{sid}: source usage count mismatch')

orig_root = ROOT / 'traceability/original_route_knowledge_base_v0.10.2'
if orig_root.exists():
    original_paths = {
        p.relative_to(orig_root).as_posix()
        for pattern in ('universities/*/overlays/*.json', 'universities/*/steps/*.json')
        for p in orig_root.glob(pattern)
    }
    if original_paths != trace_paths:
        errors.append(f'Traceability mismatch: original={len(original_paths)}, release={len(trace_paths)}')

checksum_file = ROOT / 'checksums.sha256'
if not checksum_file.exists():
    errors.append('checksums.sha256 missing')
else:
    for line in checksum_file.read_text(encoding='utf-8').splitlines():
        if not line.strip():
            continue
        expected, rel = line.split('  ', 1)
        path = ROOT / rel
        if not path.exists():
            errors.append(f'Checksum file missing: {rel}')
        elif sha256(path) != expected:
            errors.append(f'Checksum mismatch: {rel}')

result = {
    'valid': not errors,
    'errors': errors,
    'warnings': warnings,
    'counts': {
        'universities': len(universities),
        'cards': len(requirements),
        'sources': len(sources),
        'links': len(links),
        'reminder_eligible_cards': sum(bool((x.get('deadline') or {}).get('reminder_eligible')) for x in requirements),
        'traceability_cards': len(trace_paths),
    },
}
print(json.dumps(result, ensure_ascii=False, indent=2))
sys.exit(0 if result['valid'] else 1)
