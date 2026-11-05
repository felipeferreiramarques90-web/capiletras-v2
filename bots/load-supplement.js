import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { AUDIT } from './dictionary-audit-config.js';

// Só os acréscimos confirmados são carregados no jogo. O relatório e a base de
// evidências ficam no servidor/ferramentas; nunca no estado ou no cliente.
export function loadSupplement(path = AUDIT.supplement, manifestPath = AUDIT.supplementManifest) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const bytes = readFileSync(path);
  if (manifest.policyVersion !== AUDIT.policyVersion || createHash('sha256').update(bytes).digest('hex') !== manifest.sha256) {
    throw Error('Suplemento do dicionário não corresponde à auditoria. Execute npm run dict:audit.');
  }
  const words = gunzipSync(bytes).toString('utf8').split('\n').filter(Boolean);
  if (words.length !== manifest.words || words.some(word => !/^[A-Z]{3,}$/.test(word)) || new Set(words).size !== words.length) {
    throw Error('Palavras inválidas no suplemento do dicionário.');
  }
  return { words, manifest };
}
