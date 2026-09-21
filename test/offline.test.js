const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = process.env.INTERVIEWPAL_TEST_ROOT || path.resolve(__dirname, '..');
const profile = require(path.join(root, 'src/lib/candidate-profile'));
const security = require(path.join(root, 'src/lib/security'));
const parser = require(path.join(root, 'src/lib/resume-parser'));
const { extractCandidateSignals } = require(path.join(root, 'src/lib/feature-engine'));
const { buildScorecard } = require(path.join(root, 'src/lib/analysis-engine'));
process.env.DATA_ENCRYPTION_KEY = 'synthetic-offline-test-only-key-not-for-deployment';
const fixture = {
  identity: { name: 'Alex Example', email: 'alex@example.test', phone: '555-010-1234', links: ['https://example.test'] },
  education: [{ school: 'Example University', degree: 'Bachelor of Science in Data Science', graduation: 'May 2027' }],
  skills: { languages: ['Python', ' SQL ', 'Python'] },
  projects: [{ name: 'Pipeline', highlights: ['Built a Python data pipeline with a team and reduced test runtime by 20%.'] }]
};
test('normalization trims and deduplicates supported lists', () => {
  const p = profile.normalizeCandidateProfile(fixture);
  assert.deepEqual(p.skills.languages, ['Python', 'SQL']);
  assert.deepEqual(p.skills.all, ['Python', 'SQL']);
  assert.equal(p.projects[0].name, 'Pipeline');
});
test('malformed list fields become empty rather than crashing', () => {
  const p = profile.normalizeCandidateProfile({ identity: { links: {} }, skills: { languages: 'Python' }, projects: [{name:'P',highlights:9}] });
  assert.deepEqual(p.identity.links, []);
  assert.deepEqual(p.skills.languages, []);
  assert.deepEqual(p.projects[0].highlights, []);
});
test('model summary removes direct contact fields without mutating input', () => {
  const p = profile.normalizeCandidateProfile(fixture);
  const summary = profile.candidateToPromptSummary(p);
  assert.equal(summary.identity.email, ''); assert.equal(summary.identity.phone, '');
  assert.deepEqual(summary.identity.links, []); assert.equal(p.identity.email, 'alex@example.test');
});
test('AES-GCM roundtrip, random nonce, and authentication failure on tampering', () => {
  const a = security.encryptJson(fixture), b = security.encryptJson(fixture);
  assert.notEqual(a,b); assert.deepEqual(security.decryptJson(a),fixture);
  const tampered = JSON.parse(a); const bytes=Buffer.from(tampered.data,'base64');bytes[0]^=1;tampered.data=bytes.toString('base64');
  assert.throws(()=>security.decryptJson(JSON.stringify(tampered)));
});
test('Argon2 password verification accepts correct and rejects wrong password', async () => {
  const h=await security.hashPassword('synthetic-password');
  assert.equal(await security.verifyPassword(h,'synthetic-password'),true);
  assert.equal(await security.verifyPassword(h,'wrong-password'),false);
});
test('CSRF token is stable per session and differs across sessions', () => {
  const session={}; const a=security.ensureCsrfToken(session);
  assert.equal(a,security.ensureCsrfToken(session)); assert.notEqual(a,security.ensureCsrfToken({}));
  assert.equal(security.constantTimeEquals(a,a),true); assert.equal(security.constantTimeEquals(a,'short'),false);
});
test('deterministic scorecard dimensions remain finite and bounded', () => {
  for (const f of [fixture,{}]) {
    const p=profile.normalizeCandidateProfile(f);const signals=extractCandidateSignals(p,'Data Science Intern',{});
    const score=buildScorecard(p,'Data Science Intern',{},signals);
    assert.ok(Number.isFinite(score.overallScore));assert.ok(score.overallScore>=0&&score.overallScore<=100);
    for(const v of Object.values(score.subscores)){assert.ok(Number.isFinite(v));assert.ok(v>=0&&v<=100);}
  }
});
test('unsupported resume extension is rejected', async()=> {
  await assert.rejects(parser.parseResumeFile({originalname:'resume.exe',buffer:Buffer.from('fixture')}),/Unsupported resume file type/);
});
test('real text PDF extracts candidate identity and skills in memory', async()=> {
  const PDFDocument=require('pdfkit');const doc=new PDFDocument();const chunks=[];
  const finished=new Promise((resolve,reject)=>{doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
  doc.text('Alex Example\nalex@example.test\nEducation\nExample University\nBachelor of Science in Data Science\nMay 2027\nTechnical Skills\nPython, SQL, JavaScript, Git\nProjects\nData Pipeline\n- Built a Python data pipeline to process structured records and validate schema consistency.\n- Added repeatable unit checks with SQL validation and clear documentation for team collaboration.');doc.end();
  const result=await parser.parseResumeFile({originalname:'synthetic-resume.pdf',buffer:await finished});
  assert.equal(result.extractionMode,'pdf-text');assert.equal(result.candidateProfile.identity.email,'alex@example.test');
  assert.ok(result.candidateProfile.skills.all.some(s=>s.toLowerCase()==='python'));
});
