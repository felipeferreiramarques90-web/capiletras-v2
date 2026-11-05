import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, rename, rm } from 'node:fs/promises';
import { createGunzip, createGzip } from 'node:zlib';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';

export async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
export async function sha256GzipContent(path) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), createGunzip(), async source => {
    for await (const chunk of source) hash.update(chunk);
  });
  return hash.digest('hex');
}
export async function* readLines(path) {
  const file = createReadStream(path);
  const stream = String(path).endsWith('.gz') ? file.pipe(createGunzip()) : file;
  const forward = error => stream.destroy(error);
  file.on('error', forward);
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try { for await (const line of lines) yield line; }
  finally { lines.close(); file.destroy(); stream.destroy(); }
}
// O destino só é trocado após o gzip terminar. Fontes/candidatos não ficam
// truncados se houver erro de rede, de parser ou de disco.
export function gzipWriter(path) {
  const target = path instanceof URL ? path : pathToFileURL(resolve(path));
  const temporary = new URL(target.href + `.tmp-${process.pid}`);
  const zip = createGzip({ level: 9 });
  const result = pipeline(zip, createWriteStream(temporary));
  // Erros são observados também antes de finish(), evitando rejeição sem handler.
  void result.catch(() => {});
  return {
    async write(text) { if (zip.destroyed) throw zip.errored || Error('Escrita gzip encerrada.'); if (!zip.write(text)) await once(zip, 'drain'); },
    async finish() { zip.end(); await result; await rename(temporary, target); },
    async abort() { zip.destroy(); await result.catch(() => {}); await rm(temporary, { force: true }); },
  };
}
export async function verifiedManifest(path, manifestPath, field = 'sha256') {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (await sha256File(path) !== manifest[field]) throw Error(`Hash inválido: ${String(path)}`);
  return manifest;
}
