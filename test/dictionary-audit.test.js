import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { AUDIT } from '../bots/dictionary-audit-config.js';
import { referenceForms, classifyWord, auditEntries, sourceLinks } from '../scripts/dictionary-audit-policy.js';
import { readReference, parseAuditArguments } from '../scripts/audit-dictionary.js';
import { loadSupplement } from '../bots/load-supplement.js';
import { gzipWriter, readLines, sha256GzipContent } from '../scripts/dictionary-io.js';
import { loadDictionary } from '../bots/load-dictionary.js';
const noun = (word, extra = {}) => ({ word, lang_code: 'pt', pos: 'noun', senses: [{ glosses: ['definição'] }], ...extra });
const evidence = lemma => [{ source: 'ptwiktionary', lemma }];
async function temp(t) { const dir = await mkdtemp(join(tmpdir(), 'dict-audit-')); t.after(() => rm(dir, { recursive: true, force: true })); return name => join(dir, name); }
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('referência normaliza acentos, plurais e conjugações documentadas sem inventar derivados', () => {
  const entry = noun('ação', { forms: [{ form: 'ações' }, { form: 'ações' }] });
  assert.deepEqual(referenceForms(entry).words, ['ACAO', 'ACOES']);
  assert.deepEqual(referenceForms(noun('correr', { pos: 'verb', forms: [{ form: 'correndo' }, { form: 'correram' }] })).words, ['CORRER', 'CORRENDO', 'CORRERAM']);
  assert.deepEqual(referenceForms(noun('driblar', { pos: 'verb' })).words, ['DRIBLAR']);
});
for (const [word, fields] of [['Brasil', {}], ['ONU', {}], ['guarda-chuva', {}], ["d'água", {}], ['bom dia', {}], ['s.m.s.', {}], ['eu', {}], ['maria', { pos: 'name' }], ['pix', { pos: 'abbrev' }]]) {
  test(`referência rejeita ${word} antes da normalização e suas formas derivadas`, () => {
    assert.deepEqual(referenceForms(noun(word, { ...fields, forms: [{ form: 'falsoconfirmado' }] })).words, []);
  });
}
test('só português; traduções, exemplos e etimologias não confirmam palavras', () => {
  const entry = noun('casa', { lang_code: 'es', translations: [{ word: 'português' }], forms: [{ form: 'casas' }] });
  assert.deepEqual(referenceForms(entry).words, []);
  assert.deepEqual(referenceForms(noun('casa', { translations: [{ word: 'qualquercoisa' }], examples: ['inventado'] })).words, ['CASA']);
});
for (const tag of ['acronym', 'abbreviation', 'initialism', 'proper-noun', 'misspelling', 'nonstandard']) {
  test(`metadado ${tag} não se torna confirmação`, () => {
    assert.equal(referenceForms(noun('palavra', { tags: [tag] })).words.length, 0);
    assert.equal(referenceForms(noun('palavra', { senses: [{ tags: [tag] }] })).words.length, 0);
    assert.deepEqual(referenceForms(noun('casa', { forms: [{ form: 'errada', tags: [tag] }] })).words, ['CASA']);
  });
}
test('variante só de Portugal é excluída; sentido brasileiro ou neutro continua elegível', () => {
  assert.deepEqual(referenceForms(noun('autocarro', { senses: [{ tags: ['Portugal'] }] })).words, []);
  assert.deepEqual(referenceForms(noun('casa', { senses: [{ tags: ['Portugal'] }, { tags: ['Brazil'] }] })).words, ['CASA']);
});
test('ausência vira não confirmada, exceções prevalecem sobre ausência e bloqueio sobre tudo', () => {
  const context = { reference: new Map([['CASA', evidence('casa')], ['BRASIL', evidence('brasil')]]), accepted: new Set(['DRIBLAVEL', 'BRASIL']), blocked: new Set(['BRASIL']) };
  assert.equal(classifyWord('CASA', context), 'confirmada');
  assert.equal(classifyWord('BUCUNIS', context), 'nao_confirmada');
  assert.equal(classifyWord('DRIBLAVEL', context), 'excecao_da_casa');
  assert.equal(classifyWord('BRASIL', context), 'bloqueada');
});
test('auditoria percorre todas as palavras, deduplica acentos e só acrescenta lacunas confirmadas', async () => {
  const reference = new Map([['CASA', evidence('casa')], ['PIX', evidence('pix')], ['BRASIL', evidence('brasil')]]);
  const records = [], additions = [];
  const result = await auditEntries(['casa', 'ação', 'acao', 'palavrarara', 'brasil', 'ONU', 'guarda-chuva'], {
    reference, accepted: new Set(['DRIBLAVEL', 'BRASIL']), blocked: new Set(['BRASIL']),
    onRecord: record => records.push(record), onAddition: record => additions.push(record),
  });
  assert.equal(result.counts.baseWords, 4); assert.equal(result.counts.unconfirmed, 2);
  assert.equal(result.counts.houseExceptions, 1); assert.equal(result.counts.additions, 1);
  assert.equal(result.counts.blocked, 1); assert.equal(result.finalWords, 5);
  assert.deepEqual(additions.map(r => r.word), ['PIX']); assert.equal(additions[0].origin, 'referencia');
  assert.equal(records.find(r => r.word === 'PALAVRARARA').status, 'nao_confirmada');
  assert.equal(records.find(r => r.word === 'DRIBLAVEL').status, 'excecao_da_casa');
  assert.equal(records.find(r => r.word === 'CASA').evidence[0].url, 'https://pt.wiktionary.org/wiki/casa');
});
test('falta de referência produz erro, não confirmação falsa ou fallback permissivo', () => {
  assert.throws(() => sourceLinks([{ source: 'desconhecida', lemma: 'casa' }]), /desconhecida/);
});
test('referência exige hash, versão, fontes conhecidas e contagem correta', async t => {
  const path = await temp(t), file = path('reference.gz'), manifest = path('manifest.json');
  const bytes = gzipSync('CASA\tptwiktionary\tcasa\nCASA\tenwiktionary\tcasa\n');
  await writeFile(file, bytes); const meta = { sha256: hash(bytes), words: 1, policyVersion: AUDIT.policyVersion, sources: AUDIT.sources.map(({id,sha256})=>({id,sha256})) };
  await writeFile(manifest, JSON.stringify(meta));
  assert.equal((await readReference(file, manifest)).reference.get('CASA').length, 2);
  await writeFile(manifest, JSON.stringify({ ...meta, sources: [] })); await assert.rejects(readReference(file, manifest), /desatualizadas/);
  await writeFile(manifest, JSON.stringify({ ...meta, words: 2 })); await assert.rejects(readReference(file, manifest), /Contagem/);
  await writeFile(manifest, JSON.stringify({ ...meta, sha256: 'wrong' })); await assert.rejects(readReference(file, manifest), /Hash/);
});
test('suplemento só aceita artefato íntegro, normalizado, sem duplicatas e com contagem certa', async t => {
  const path = await temp(t), file = path('supplement.gz'), manifest = path('manifest.json');
  async function save(text, words = 1) { const bytes = gzipSync(text); await writeFile(file, bytes); await writeFile(manifest, JSON.stringify({ sha256: hash(bytes), words, policyVersion: AUDIT.policyVersion })); }
  await save('CASA\n'); assert.deepEqual(loadSupplement(file, manifest).words, ['CASA']);
  await save('Casa\n'); assert.throws(() => loadSupplement(file, manifest), /inválidas/);
  await save('CASA\nCASA\n', 2); assert.throws(() => loadSupplement(file, manifest), /inválidas/);
  await save('CASA\n'); await writeFile(file, gzipSync('FAKE\n')); assert.throws(() => loadSupplement(file, manifest), /auditoria/);
});
test('bloqueio da casa continua tendo prioridade no dicionário; relatório não modifica entrada', async t => {
  const path = await temp(t), file = path('base.txt'); await writeFile(file, 'casa\npalavrarara\n');
  const before = await readFile(file, 'utf8');
  const dictionary = loadDictionary(file, { blocked: new Set(['CASA']), accepted: new Set(['DRIBLAVEL', 'CASA']) });
  assert.equal(dictionary.isWord('CASA'), false); assert.equal(dictionary.isWord('DRIBLAVEL'), true); assert.equal(dictionary.isWord('PALAVRARARA'), true);
  assert.equal(await readFile(file, 'utf8'), before);
});
test('gzip de relatórios é completo e só troca destino quando finaliza; erro não publica parcial', async t => {
  const path = await temp(t), file = path('report.gz'); await writeFile(file, gzipSync('antigo\n'));
  const writer = gzipWriter(file); await writer.write('novo\n');
  assert.deepEqual(await Array.fromAsync(readLines(file)), ['antigo']); await writer.finish();
  assert.deepEqual(await Array.fromAsync(readLines(file)), ['novo']);
  const failed = gzipWriter(file); await failed.write('incompleto\n'); await failed.abort();
  assert.deepEqual(await Array.fromAsync(readLines(file)), ['novo']);
});

test('entradas com aviso de idioma incorreto não são usadas para confirmar automaticamente',()=>{
 assert.deepEqual(referenceForms(noun('zzz',{pos:'intj',senses:[{glosses:['som'],categories:[{name:'Portuguese entries with incorrect language header'}]}]})).words,[]);
 assert.deepEqual(referenceForms(noun('casa',{categories:['Portuguese entries with etymology']})).words,['CASA']);
});

test('CLI diferencia publicação, relatório e conferência somente leitura e rejeita flags desconhecidas',()=>{
 assert.deepEqual(parseAuditArguments(['CASA']),{check:false,reportOnly:false,words:['CASA']});
 assert.deepEqual(parseAuditArguments(['--report-only','CASA']),{check:false,reportOnly:true,words:['CASA']});
 assert.deepEqual(parseAuditArguments(['--check','CASA']),{check:true,reportOnly:true,words:['CASA']});
 assert.throws(()=>parseAuditArguments(['--unknown']),/Use/);
});

test('conferência compara conteúdo e tolera compactações gzip diferentes sem confundir integridade',async t=>{
 const path=await temp(t),a=path('a.gz'),b=path('b.gz'),content='PALAVRA\n'.repeat(100);
 await writeFile(a,gzipSync(content,{level:1}));await writeFile(b,gzipSync(content,{level:9}));
 assert.notEqual(hash(await readFile(a)),hash(await readFile(b)));
 assert.equal(await sha256GzipContent(a),await sha256GzipContent(b));
});

test('uma palavra não confirmada passa a ser recusada ao ser explicitamente bloqueada pela mesa',async()=>{
 const reference=new Map([['CASA',[{source:'ptwiktionary',lemma:'casa'}]]]),blocked=new Set(['LLALLAGUALITAS']),accepted=new Set(['DRIBLAVEL']),records=[];
 const result=await auditEntries(['llallagualitas','casa'],{reference,blocked,accepted,onRecord:r=>records.push(r)});
 assert.equal(records.find(r=>r.word==='LLALLAGUALITAS').status,'bloqueada');
 assert.equal(result.counts.unconfirmed,0);assert.equal(result.counts.blocked,1);assert.equal(result.finalWords,2);
 assert.equal(records.find(r=>r.word==='DRIBLAVEL').status,'excecao_da_casa');
});
