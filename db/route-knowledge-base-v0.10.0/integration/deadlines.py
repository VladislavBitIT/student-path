"""Reference calculator for explicit deadline models; incomplete models stay unknown."""
from datetime import date, datetime, time, timedelta, timezone
from calendar import monthrange
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

class UnknownDeadline(Exception): pass
def instant(value):return datetime.fromisoformat(value.replace('Z','+00:00'))
def utc(value):return value.astimezone(timezone.utc).isoformat().replace('+00:00','Z')
def localize(day,clock,zone):
    naive=datetime.combine(day,time.fromisoformat(clock));valid={}
    for fold in (0,1):
        local=naive.replace(tzinfo=zone,fold=fold);stamp=local.astimezone(timezone.utc)
        if stamp.astimezone(zone).replace(tzinfo=None)==naive:valid[stamp]=local
    if len(valid)!=1:raise UnknownDeadline('ambiguous_or_nonexistent_local_time')
    return next(iter(valid.values()))

def calculate(model, facts, events, trigger_event, as_of, calendars):
    kind=model['kind']
    if kind=='none':return {'state':'none'}
    if kind in ['unknown','partial']:return {'state':'unknown','reason':'incomplete_model'}
    if kind=='fixed':return {'state':'known','at':utc(instant(model['at']))}
    try:
        zone=ZoneInfo(model['timezone']);anchor=model['anchor']
        if anchor['kind']=='trigger_event':
            if trigger_event is None:raise UnknownDeadline('missing_anchor')
            value=trigger_event['occurred_at']
        elif anchor['kind']=='fact':
            value=facts.get(anchor['fact'])
            if value is None:raise UnknownDeadline('missing_anchor')
        else:
            eligible=sorted((e for e in events if e['event_type']==anchor['event_type'] and instant(e['occurred_at'])<=instant(as_of)),key=lambda e:(instant(e['occurred_at']),e['id']))
            if not eligible:raise UnknownDeadline('missing_anchor')
            value=eligible[0 if anchor['occurrence']=='first' else -1]['occurred_at']
        moment=instant(value) if 'T' in value else None
        day=moment.astimezone(zone).date() if moment else date.fromisoformat(value)
        amount=model['amount'];direction=1 if model['direction']=='after' else -1
        unit=model['unit'];calendar=None
        if unit=='business_day' or model['rollover']!='none':
            calendar=calendars.get(model.get('calendar_ref'))
            if calendar is None:raise UnknownDeadline('missing_calendar')
            if calendar['timezone']!=model['timezone']:raise UnknownDeadline('calendar_timezone_mismatch')
        def working(d):
            if not calendar['coverage_start']<=d.isoformat()<=calendar['coverage_end']:raise UnknownDeadline('calendar_out_of_coverage')
            if d.isoformat() in calendar['working_dates']:return True
            if d.isoformat() in calendar['non_working_dates']:return False
            return d.isoweekday() not in calendar['weekend_days']
        if unit=='hour':
            if moment is None:raise UnknownDeadline('imprecise_hour_anchor')
            return {'state':'known','at':utc(moment.astimezone(timezone.utc)+timedelta(hours=direction*amount))}
        if unit=='business_day':
            anchor_working=working(day)
            remaining=amount-(1 if amount and model['include_anchor_day'] and anchor_working else 0)
            while remaining:
                day+=timedelta(days=direction)
                if working(day):remaining-=1
        elif unit=='calendar_day':
            day+=timedelta(days=direction*max(0,amount-(1 if model['include_anchor_day'] else 0)))
        elif unit in ['calendar_month','calendar_year']:
            months=direction*amount*(12 if unit=='calendar_year' else 1)
            year,month=divmod(day.year*12+day.month-1+months,12);month+=1
            maximum=monthrange(year,month)[1]
            if day.day>maximum and model['month_end']=='error':raise UnknownDeadline('month_end_overflow')
            day=date(year,month,min(day.day,maximum))
        else:raise ValueError('Unsupported deadline unit')
        if model['rollover']!='none':
            delta=1 if model['rollover']=='next_business_day' else -1
            while not working(day):day+=timedelta(days=delta)
        return {'state':'known','at':utc(localize(day,model['time_of_day'],zone))}
    except (UnknownDeadline,ZoneInfoNotFoundError) as exc:
        return {'state':'unknown','reason':str(exc) if isinstance(exc,UnknownDeadline) else 'unknown_timezone'}
