import json
p='package.json'
d=json.load(open(p))
d['devDependencies']={'mailparser':'^3.14.1','smtp-server':'^3.21.3'}
json.dump(d,open(p,'w'),indent=2); open(p,'a').write('\n')
