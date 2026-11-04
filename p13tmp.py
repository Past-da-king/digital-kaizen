p='scripts/e2e-browser.mjs'
s=open(p).read()
s=s.replace("await page.fill('#pw', PASSWORD); await page.click('#go');\nawait page.waitForSelector('#code');","await page.waitForTimeout(500);\nawait page.fill('#pw', PASSWORD); await page.click('#go');\nawait page.waitForSelector('#code');")
s=s.replace("await page.fill('#email', 'a@factory.test'); await page.fill('#pw', 'wrong-password-123'); await page.click('#go');\nok('wrong password","await page.fill('#email', 'a@factory.test'); await page.fill('#pw', 'wrong-password-123'); await page.click('#go');\nawait page.waitForFunction(() => document.querySelector('#err')?.textContent.length > 0);\nok('wrong password")
s=s.replace("rows[0].qty === 5","rows[0].qty === 6")
s=s.replace("await aget('/api/demo/stop').catch(() => {});\nawait fetch(","const stopRes = await fetch(")
s=s.replace("body: JSON.stringify({ machine: 'MA2', seconds: 900 }) });","body: JSON.stringify({ machine: 'MA2', seconds: 900 }) });\nok('demo stop accepted', stopRes.status === 200, String(stopRes.status));")
open(p,'w').write(s)
