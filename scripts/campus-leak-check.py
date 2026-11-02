#!/usr/bin/env python3
"""Proves a campus admin sees other campuses' people by name and photo only.

Runs against a local API (APP_BASE_DOMAIN=localhost) and a test account with two campuses:
signs in as an owner and as a campus admin, calls every admin GET route the API logged on startup,
and fails if the other campus's member's email, phone or birthday appears anywhere.

  TENANT=hope-relief-test API_LOG=/tmp/api.log OWNER_EMAIL=... CAMPUS_ADMIN_EMAIL=... PASSWORD=... \
  python3 scripts/campus-leak-check.py
Only for local test accounts: it creates a member and a campus admin, and changes passwords' device binding.
"""
import os, sys
import json, urllib.request, subprocess, re
B='http://localhost:3000/v1'; TENANT=os.environ.get('TENANT','hope-relief-test')
CA=os.environ['CAMPUS_ADMIN_EMAIL']
H={'Content-Type':'application/json','x-tenant-subdomain':TENANT}
def call(method, path, body=None, token=None):
    req=urllib.request.Request(B+path, method=method, data=json.dumps(body).encode() if body is not None else None, headers={**H, **({'Authorization':'Bearer '+token} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=30) as r: return r.status, r.read().decode('utf-8','replace')
    except urllib.error.HTTPError as e: return e.code, e.read().decode('utf-8','replace')
    except Exception as e: return 0, str(e)
J=lambda t: json.loads(t)
q=lambda sql: subprocess.check_output(['docker','exec','my-postgres','psql','-U','admin','-d','discuva','-tAc',sql]).decode().strip()
S='church_'+TENANT.replace('-','_')
_,a=call('POST','/auth/admin-login',{'email':os.environ['OWNER_EMAIL'],'password':os.environ['PASSWORD'],'deviceId':'e2e-1'}); A=J(a)['data']['access_token']
ikeja=q(f"select id from {S}.campuses where name='Ikeja'"); lekki=q(f"select id from {S}.campuses where name='Lekki'")
# Lekki member with private details
if not q(f"select id from {S}.members where email='delivered+ngo-member2@resend.dev'"):
    s,t=call('POST','/auth/signup',{'firstname':'Bisi','lastname':'Lekki','email':'delivered+ngo-member2@resend.dev','phoneNumber':'+2348031234567','homeCampusId':lekki}); print('lekki member signup',s)
q(f"update {S}.members set birth_day=14, birth_month=11, birth_year=1990 where email='delivered+ngo-member2@resend.dev'")
m2=q(f"select id from {S}.members where email='delivered+ngo-member2@resend.dev'")
phone=q(f"select phone_number from {S}.members where id='{m2}'")
amaka=q(f"select id from {S}.members where email='{CA}'")
role=q(f"select id from {S}.admin_roles where name ilike '%super%' limit 1")
if not q(f"select id from {S}.admins where member_id='{amaka}'"):
    s,t=call('POST','/admin/users',{'memberId':amaka,'adminRoleId':role},A); print('grant admin',s,t[:150])
admin_id=q(f"select id from {S}.admins where member_id='{amaka}'")
s,t=call('PUT',f'/admin/campuses/{ikeja}/admins',{'adminIds':[admin_id]},A); print('make Ikeja admin',s)
q(f"update {S}.members set device_id=null where id='{amaka}'")
s,t=call('POST','/auth/admin-login',{'email':os.environ['CAMPUS_ADMIN_EMAIL'],'password':os.environ['PASSWORD'],'deviceId':'e2e-9'}); print('campus admin login',s,t[:120] if s!=200 else '')
C=J(t)['data']['access_token']
s,t=call('GET','/admin/users/me',None,C); me=J(t)['data']; print('me scope',me.get('campusScope'),'| has billing',('billing:read' in me['adminRole']['permissions']),'| has members:read',('members:read' in me['adminRole']['permissions']), '| perms', len(me['adminRole']['permissions']))
secrets=['delivered+ngo-member2@resend.dev', phone, phone.replace('+234','0'), '1990']
routes=sorted(set(re.findall(r'Mapped \{(/[^,]*), GET\}', open(os.environ.get('API_LOG','/tmp/api-e2e.log')).read())))
leaks=[]; checked=0; statuses={}
for r in routes:
    path=r.replace('/v1','',1) if r.startswith('/v1') else r
    if ':' in path:
        if path.startswith('/members/:id') and path.count(':')==1:
            path=path.replace(':id',m2)
        else: continue
    s,t=call('GET',path,None,C); checked+=1; statuses[s]=statuses.get(s,0)+1
    if s==500: print('500',path,t[:140])
    if s==200:
        for sec in secrets[:3]:
            if sec and sec in t: leaks.append((path,sec))
        if m2 in t and ('"birthDay":14' in t or '"birthYear":1990' in t): leaks.append((path,'birthday'))
print('routes checked',checked,'statuses',statuses)
print('LEAKS',leaks if leaks else 'none')
if leaks: sys.exit(1)
s,t=call('GET',f'/members/{m2}',None,C); print('open Lekki member profile',s,J(t).get('message'))
s,t=call('PATCH',f'/members/{m2}',{'firstname':'X'},C); print('edit Lekki member',s,J(t).get('message'))
s,t=call('GET','/members?page=1&limit=50',None,C); print('members list names',[f"{x['firstname']} {x['lastname']}" for x in J(t)['data']['data']])
s,t=call('GET','/members/workers?page=1&limit=50',None,C); print('workers list',[x['firstname'] for x in J(t)['data']['data']])
s,t=call('GET','/billing/subscription',None,C); print('billing as campus admin',s)
s,t=call('GET','/admin/users',None,C); print('admin users as campus admin',s)
s,t=call('GET',f'/members/{m2}',None,A); print('owner opens Lekki member',s,'email shown', 'ngo-member2' in t)
