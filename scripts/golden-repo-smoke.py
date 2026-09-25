#!/usr/bin/env python3
"""Authored, multi-file micro-repository fixtures. NOT model or HackerRank scores.
Each buggy baseline must compile and fail its assertions; the authored gold
replacement must compile and pass. Only local standard-library toolchains are used.
"""
import argparse
import json
import pathlib
import shutil
import subprocess
import time

CASES = [
    {'id': 'transition', 'fn': 'accepts', 'task': 'Allow only PROCESSING(1) to SHIPPED(2). Preserve the public API.', 'cases': [(1,2,1),(3,2,0),(1,3,0),(0,0,0)], 'good': '(a == 1 && b == 2)', 'bad': '(a == 1 || b == 2)', 'boolean': True},
    {'id': 'quota-boundary', 'fn': 'withinLimit', 'task': 'A request is allowed only while usage is strictly less than the limit.', 'cases': [(0,3,1),(2,3,1),(3,3,0),(4,3,0)], 'good': '(a < b)', 'bad': '(a <= b)', 'boolean': True},
    {'id': 'expiry-boundary', 'fn': 'isExpired', 'task': 'A record expires at its deadline, not one unit after its deadline.', 'cases': [(9,10,0),(10,10,1),(11,10,1),(0,0,1)], 'good': '(a >= b)', 'bad': '(a > b)', 'boolean': True},
    {'id': 'pagination', 'fn': 'offset', 'task': 'Pages are numbered from one. Return the zero-based offset for a positive page and page size.', 'cases': [(1,10,0),(2,10,10),(3,5,10),(4,1,3)], 'good': '((a - 1) * b)', 'bad': '(a * b)', 'boolean': False},
]
LANGS = ['javascript','python','java','go','csharp','rust']
TOOLS = {'javascript':'node','python':'python3','java':'javac','go':'go','csharp':'dotnet','rust':'rustc'}

def expression(case, good, lang):
    value = case['good' if good else 'bad']
    if lang == 'python':
        value = value.replace('&&','and').replace('||','or')
        return f'int({value})' if case['boolean'] else value
    if lang == 'rust': return f'if {value} {{ 1 }} else {{ 0 }}' if case['boolean'] else value
    if lang == 'go': return f'boolInt({value})' if case['boolean'] else value
    return f'({value} ? 1 : 0)' if case['boolean'] else value

def files_for(case, good, lang):
    name, expr = case['fn'], expression(case,good,lang)
    if lang == 'javascript':
        service = f'export function {name}(a, b) {{\n  return {expr};\n}}\n'
        tests = '\n'.join(f'assert.equal(handle({a}, {b}), {expected});' for a,b,expected in case['cases'])
        return {'Service.mjs':service,'Controller.mjs':f'import {{ {name} }} from "./Service.mjs";\nexport const handle = (a, b) => {name}(a, b);\n','Tests.mjs':f'import assert from "node:assert/strict";\nimport {{ handle }} from "./Controller.mjs";\n{tests}\nconsole.log("Tests: 4 passed, 0 failed");\n'}, [], ['node','Tests.mjs']
    if lang == 'python':
        tests = '\n'.join(f'assert handle({a}, {b}) == {expected}, "case {index}"' for index,(a,b,expected) in enumerate(case['cases']))
        return {'Service.py':f'def {name}(a, b):\n    return {expr}\n','Controller.py':f'from Service import {name}\ndef handle(a, b):\n    return {name}(a, b)\n','Tests.py':f'from Controller import handle\n{tests}\nprint("Tests: 4 passed, 0 failed")\n'}, [], ['python3','-B','Tests.py']
    if lang == 'java':
        tests = '\n'.join(f'    if (Controller.handle({a}, {b}) != {expected}) throw new AssertionError("case {index}");' for index,(a,b,expected) in enumerate(case['cases']))
        return {'Service.java':f'public class Service {{\n  public static int {name}(int a, int b) {{\n    return {expr};\n  }}\n}}\n','Controller.java':f'public class Controller {{\n  public static int handle(int a, int b) {{ return Service.{name}(a, b); }}\n}}\n','Tests.java':f'public class Tests {{\n  public static void main(String[] args) {{\n{tests}\n    System.out.println("Tests: 4 passed, 0 failed");\n  }}\n}}\n'}, [['javac','Service.java','Controller.java','Tests.java']], ['java','Tests']
    if lang == 'go':
        tests = '\n'.join(f'  if Handle({a}, {b}) != {expected} {{ t.Fatalf("case {index}") }}' for index,(a,b,expected) in enumerate(case['cases']))
        return {'go.mod':'module fixture\n\ngo 1.22\n','Service.go':f'package fixture\nfunc boolInt(v bool) int {{ if v {{ return 1 }}; return 0 }}\nfunc {name}(a int, b int) int {{\n  return {expr}\n}}\n','Controller.go':f'package fixture\nfunc Handle(a int, b int) int {{ return {name}(a, b) }}\n','Service_test.go':f'package fixture\nimport "testing"\nfunc TestContract(t *testing.T) {{\n{tests}\n}}\n'}, [['go','test','-c','-o','test-bin']], ['./test-bin','-test.v']
    if lang == 'csharp':
        tests = '\n'.join(f'if (Controller.Handle({a}, {b}) != {expected}) throw new System.Exception("case {index}");' for index,(a,b,expected) in enumerate(case['cases']))
        return {'Fixture.csproj':'<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>\n','Service.cs':f'public static class Service {{\n  public static int {name}(int a, int b) {{\n    return {expr};\n  }}\n}}\n','Controller.cs':f'public static class Controller {{\n  public static int Handle(int a, int b) => Service.{name}(a, b);\n}}\n','Program.cs':f'{tests}\nSystem.Console.WriteLine("Tests: 4 passed, 0 failed");\n'}, [['dotnet','build','Fixture.csproj','--nologo','--verbosity','quiet','--ignore-failed-sources']], ['dotnet','bin/Debug/net8.0/Fixture.dll']
    tests = '\n'.join(f'  assert_eq!(controller::handle({a}, {b}), {expected});' for a,b,expected in case['cases'])
    return {'service.rs':f'pub fn {name}(a: i32, b: i32) -> i32 {{\n  {expr}\n}}\n','controller.rs':f'pub fn handle(a: i32, b: i32) -> i32 {{ crate::service::{name}(a, b) }}\n','tests.rs':f'mod service;\nmod controller;\n#[test]\nfn contract() {{\n{tests}\n}}\n'}, [['rustc','--edition','2021','--test','tests.rs','-o','test-bin']], ['./test-bin','--nocapture']

def run_command(args, cwd):
    started = time.monotonic()
    result = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=90, check=False)
    return {'command': args, 'exitCode': result.returncode, 'elapsedMs': round((time.monotonic()-started)*1000), 'stdout': result.stdout[-10000:], 'stderr': result.stderr[-10000:]}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--languages', default=','.join(LANGS))
    parser.add_argument('--output', default='qa-results/golden')
    options = parser.parse_args()
    languages = options.languages.split(',')
    if any(lang not in LANGS for lang in languages): parser.error('Unknown language')
    output = pathlib.Path(options.output).resolve(); output.mkdir(parents=True,exist_ok=True)
    report = {'kind':'authored-golden-micro-repo-smoke','modelInference':False,'cases':[]}
    for lang in languages:
        if not shutil.which(TOOLS[lang]): raise RuntimeError(f'{TOOLS[lang]} is required; not silently skipping {lang}')
        for case in CASES:
            work = output/'repos'/f'{lang}-{case["id"]}'; work.mkdir(parents=True,exist_ok=True)
            runs = []
            old,_,_ = files_for(case,False,lang); new,_,_ = files_for(case,True,lang)
            changed = [name for name in old if old[name] != new[name]]
            assert len(changed) == 1, 'Gold patch must modify only the service'
            for good in (False, True):
                files, build, command = files_for(case,good,lang)
                for name,content in files.items(): (work/name).write_text(content)
                compiled = [run_command(args,work) for args in build]
                assert all(item['exitCode'] == 0 for item in compiled), f'Fixture failed to compile: {lang}/{case["id"]}: {compiled}'
                result = run_command(command,work)
                assert (result['exitCode'] == 0) == good, f'Expected {"pass" if good else "assertion failure"}: {lang}/{case["id"]}: {result}'
                runs.append({'variant':'authored-gold' if good else 'buggy-baseline','compile':compiled, 'test':result})
            expectation = {'id':f'{lang}-{case["id"]}','task':case['task'],'expectedFiles':[changed[0]],'goldPatch':{'path':changed[0],'before':old[changed[0]],'after':new[changed[0]]},'acceptanceCases':case['cases'],'note':'Public smoke fixture; exclude this expectation from model input. Reordered equivalent code is acceptable when tests pass.'}
            (work/'expectations.json').write_text(json.dumps(expectation,indent=2))
            session = expectation['id']; events=[]
            def emit(payload): events.append({'id':f'event-{len(events)+1}','sessionId':session,'at':1000*len(events),**payload})
            emit({'type':'session.start','permission':'practice','objective':case['task']})
            emit({'type':'question.new','original':case['task'],'text':case['task']})
            for name,content in old.items():
                emit({'type':'screen.observed','origin':'replay','observation':{'files':[{'path':name,'language':lang,'startLine':1,'lines':content.splitlines(),'confidence':1,'endOfFile':True}],'visiblePaths':list(old),'requirements':[],'terminal':''}})
            emit({'type':'screen.observed','origin':'replay','observation':{'files':[{'path':changed[0],'language':lang,'startLine':1,'lines':new[changed[0]].splitlines(),'confidence':1,'endOfFile':True}],'visiblePaths':[],'requirements':[],'terminal':''}})
            emit({'type':'test.start','command':' '.join(runs[-1]['test']['command'])})
            emit({'type':'screen.observed','origin':'replay','observation':{'files':[],'visiblePaths':[],'requirements':[],'terminal':'Tests: 4 passed, 0 failed'}})
            replay={'format':'livetranscript-repo-replay-v1','sessionId':session,'truncated':False,'events':events,'evaluations':[],'feedback':[],'note':'Generated from authored fixture executions. No screenshot/ASR/model accuracy is being measured.'}
            (output/f'{session}-replay.json').write_text(json.dumps(replay,indent=2))
            report['cases'].append({'id':session,'passed':True,'changedFiles':changed,'runs':runs})
    report['passed']=True; report['count']=len(report['cases'])
    (output/'report.json').write_text(json.dumps(report,indent=2))
    print(json.dumps({'passed':True,'microRepositories':len(report['cases']),'modelInference':False,'report':str(output/'report.json')}))
if __name__ == '__main__': main()
