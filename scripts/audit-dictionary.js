import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AUDIT } from '../bots/dictionary-audit-config.js';
import { DICTIONARY } from '../bots/dictionary-config.js';
import { houseLists } from '../bots/load-dictionary.js';
import { normalizeWord } from '../bots/dictionary.js';
import { auditEntries, classifyWord, sourceLinks } from './dictionary-audit-policy.js';
import { readLines, sha256File, sha256GzipContent, gzipWriter, verifiedManifest } from './dictionary-io.js';

export async function readReference(path = AUDIT.reference, manifestPath = AUDIT.referenceManifest) {
  const manifest = await verifiedManifest(path, manifestPath);
  if (manifest.policyVersion !== AUDIT.policyVersion) throw Error('Referência foi construída com outra política. Execute dict:reference.');
  if (!Array.isArray(manifest.sources) || manifest.sources.length !== AUDIT.sources.length
    || AUDIT.sources.some(source => manifest.sources.filter(item => item.id === source.id && item.sha256 === source.sha256).length !== 1)) {
    throw Error('Fontes da referência estão desatualizadas. Execute dict:reference.');
  }
  const reference = new Map();
  for await (const line of readLines(path)) {
    const [word, source, lemma, extra] = line.split('\t');
    if (!/^[A-Z]{3,}$/.test(word) || !AUDIT.sources.some(item => item.id === source)
      || !lemma || extra !== undefined) throw Error('Registro inválido na referência.');
    if (!reference.has(word)) reference.set(word, []);
    reference.get(word).push({ source, lemma });
  }
  if (!reference.size || reference.size !== manifest.words) throw Error('Contagem inválida na referência.');
  return { reference, manifest };
}

export async function runAudit({ reportOnly = false, check = false, words = [] } = {}) {
  reportOnly ||= check;
  const { reference, manifest } = await readReference(), lists = houseLists();
  await mkdir(AUDIT.reportDirectory, { recursive: true });
  const allPath = new URL('palavras.jsonl.gz', AUDIT.reportDirectory);
  const gapsPath = new URL('lacunas.jsonl.gz', AUDIT.reportDirectory);
  const stagedPath = new URL('suplemento.txt.gz', AUDIT.reportDirectory);
  const all = gzipWriter(allPath), gaps = gzipWriter(gapsPath), additions = gzipWriter(stagedPath);
  let result;
  try {
    result = await auditEntries(readLines(DICTIONARY.generated), { reference, ...lists,
      onRecord: record => all.write(JSON.stringify(record) + '\n'),
      onAddition: async record => { await gaps.write(JSON.stringify(record) + '\n'); await additions.write(record.word + '\n'); },
    });
    await Promise.all([all.finish(), gaps.finish(), additions.finish()]);
  } catch (error) { await Promise.allSettled([all.abort(), gaps.abort(), additions.abort()]); throw error; }
  const queries = words.map(raw => {
    const word = normalizeWord(raw);
    if (!word) return { word: raw, status: 'entrada_invalida' };
    return { word, inCandidateDictionary: result.seen.has(word) && !lists.blocked.has(word),
      status: classifyWord(word, { reference, ...lists }), evidence: sourceLinks(reference.get(word) || []) };
  });
  const supplementSha256 = await sha256File(stagedPath);
  const summary = { policyVersion: AUDIT.policyVersion, generatedAt: new Date().toISOString(),
    mode: check ? 'conferencia_sem_alterar' : reportOnly ? 'somente_relatorio' : 'complementar_sem_excluir',
    referenceSha256: manifest.sha256, baseSha256: await sha256File(DICTIONARY.generated),
    houseAcceptedSha256: await sha256File(DICTIONARY.accepted), houseBlockedSha256: await sha256File(DICTIONARY.blocked),
    ...result, queries, supplementSha256 };
  delete summary.seen;
  if (!reportOnly) {
    // Primeiro o arquivo completo, depois o manifesto. O carregador confere o
    // hash e rejeita um par incompleto em vez de aceitar dados silenciosamente.
    const staging = new URL(AUDIT.supplement.href + '.next');
    await writeFile(staging, await readFile(stagedPath));
    await rename(staging, AUDIT.supplement);
    await writeFile(AUDIT.supplementManifest, JSON.stringify({ policyVersion: AUDIT.policyVersion,
      sha256: supplementSha256, words: result.counts.additions, generatedAt: summary.generatedAt,
      referenceSha256: manifest.sha256, baseSha256: summary.baseSha256, license: 'CC-BY-SA-4.0' }, null, 2) + '\n');
  }
  if (!reportOnly) await writeFile(new URL('last-audit.json', AUDIT.reference), JSON.stringify(summary, null, 2) + '\n');
  await writeFile(new URL('resumo.json', AUDIT.reportDirectory), JSON.stringify(summary, null, 2) + '\n');
  if (check) {
    const published = await verifiedManifest(AUDIT.supplement, AUDIT.supplementManifest);
    const sameContent = await sha256GzipContent(AUDIT.supplement) === await sha256GzipContent(stagedPath);
    if (!sameContent || published.words !== result.counts.additions
      || published.policyVersion !== AUDIT.policyVersion || published.referenceSha256 !== manifest.sha256
      || published.baseSha256 !== summary.baseSha256) throw Error('Suplemento desatualizado. Execute npm run dict:audit e versione os resultados.');
  }
  return summary;
}
export function parseAuditArguments(args) {
  const check = args.includes('--check'), reportOnly = check || args.includes('--report-only');
  const words = args.filter(word => !['--report-only', '--check'].includes(word));
  if (words.some(word => word.startsWith('--'))) throw Error('Use --report-only, --check e/ou palavras para consultar.');
  return { check, reportOnly, words };
}
async function main() {
  console.log(JSON.stringify(await runAudit(parseAuditArguments(process.argv.slice(2))), null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
