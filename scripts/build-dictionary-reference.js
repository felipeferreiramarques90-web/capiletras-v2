import { mkdir, stat, rename, rm, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AUDIT } from '../bots/dictionary-audit-config.js';
import { referenceForms } from './dictionary-audit-policy.js';
import { readLines, sha256File, gzipWriter } from './dictionary-io.js';

async function download(source, target) {
  const temporary = new URL(target.href + '.download');
  const response = await fetch(source.url, { signal: AbortSignal.timeout(AUDIT.downloadTimeoutMs) });
  if (!response.ok) throw Error(`Download ${source.id}: HTTP ${response.status}`);
  let size = 0;
  try {
    await pipeline(async function* () {
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > AUDIT.maxDownloadBytes) throw Error('Referência excede o limite de download.');
        yield chunk;
      }
    }(), createWriteStream(temporary));
    if (await sha256File(temporary) !== source.sha256) throw Error(`A revisão de ${source.id} mudou. Atualize o hash e as datas na configuração antes de importar.`);
    await rename(temporary, target);
  } catch (error) { await rm(temporary, { force: true }); throw error; }
}

export async function buildReference(inputs = new Map(), { refresh = false } = {}) {
  await mkdir(new URL('.', AUDIT.reference), { recursive: true });
  await mkdir(AUDIT.cacheDirectory, { recursive: true });
  const reference = new Map(), sources = [];
  for (const source of AUDIT.sources) {
    const path = inputs.get(source.id) || new URL(source.id + '.jsonl.gz', AUDIT.cacheDirectory);
    if (!inputs.has(source.id) && (refresh || !await stat(path).catch(() => null))) await download(source, path);
    if ((await stat(path)).size > AUDIT.maxDownloadBytes) throw Error('Arquivo da referência excede o limite.');
    const sha256 = await sha256File(path);
    if (sha256 !== source.sha256) throw Error(`Hash da fonte ${source.id} não corresponde à revisão configurada.`);
    const stats = { entries: 0, portugueseEntries: 0, eligibleEntries: 0, rejected: {} };
    for await (const line of readLines(path)) {
      if (!line.trim()) continue;
      if (Buffer.byteLength(line) > AUDIT.maxRecordBytes) throw Error('Registro da referência excede o limite.');
      const entry = JSON.parse(line); stats.entries++;
      if (entry.lang_code === 'pt') stats.portugueseEntries++;
      const result = referenceForms(entry);
      if (result.reason) { stats.rejected[result.reason] = (stats.rejected[result.reason] || 0) + 1; continue; }
      stats.eligibleEntries++;
      for (const word of result.words) {
        let evidence = reference.get(word);
        if (!evidence) { evidence = new Map(); reference.set(word, evidence); }
        if (!evidence.has(source.id)) evidence.set(source.id, entry.word);
      }
    }
    sources.push({ ...source, ...stats, sha256 });
  }
  if (!reference.size) throw Error('Nenhuma palavra elegível nas referências.');
  const writer = gzipWriter(AUDIT.reference);
  try {
    for (const word of [...reference.keys()].sort()) {
      for (const [source, lemma] of reference.get(word)) await writer.write(`${word}\t${source}\t${lemma}\n`);
    }
    await writer.finish();
  } catch (error) { await writer.abort(); throw error; }
  const manifest = { policyVersion: AUDIT.policyVersion, generatedAt: new Date().toISOString(),
    license: 'CC-BY-SA-4.0', words: reference.size, sha256: await sha256File(AUDIT.reference), sources };
  await writeFile(AUDIT.referenceManifest, JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

async function main() {
  const inputs = new Map(), args = process.argv.slice(2); let refresh = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--download') { refresh = true; continue; }
    if (args[i] !== '--input' || !args[i + 1]) throw Error('Use --download ou --input fonte=/caminho/arquivo.jsonl.gz.');
    const value = args[++i], separator = value.indexOf('='), id = value.slice(0, separator);
    if (separator < 1 || !AUDIT.sources.some(source => source.id === id)) throw Error('Fonte de entrada desconhecida.');
    inputs.set(id, pathToFileURL(resolve(value.slice(separator + 1))));
  }
  console.log(JSON.stringify(await buildReference(inputs, { refresh }), null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
