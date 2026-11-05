import { AUDIT } from '../bots/dictionary-audit-config.js';
import { normalizeWord } from '../bots/dictionary.js';
import { rejectionReason } from '../bots/dictionary-policy.js';

const tagsOf = item => [...(item.tags || []), ...(item.raw_tags || [])];
function metadataIssue(item) {
  const tags = tagsOf(item);
  if (tags.some(tag => AUDIT.excludedTags.includes(tag))) return 'excludedTag';
  if (tags.some(tag => AUDIT.europeanTags.includes(tag)) && !tags.includes('Brazil')) return 'europeanOnly';
  return null;
}

// Nada é inferido de uma tradução, pronúncia, exemplo ou etimologia: só verbetes
// em português e suas flexões expressamente listadas pela referência.
export function referenceForms(entry) {
  if (entry.lang_code !== 'pt') return { reason: 'otherLanguage', words: [] };
  const categories = [...(entry.categories || []), ...(entry.senses || []).flatMap(sense => sense.categories || [])]
    .map(category => typeof category === 'string' ? category : category.name || '');
  if (categories.some(category => AUDIT.excludedCategoryMarkers.some(marker => category.includes(marker)))) return { reason: 'maintenanceFlag', words: [] };
  if (!AUDIT.lexicalParts.includes(entry.pos)) return { reason: 'nonLexicalPart', words: [] };
  const issue = rejectionReason(entry.word || '') || metadataIssue(entry);
  if (issue) return { reason: issue, words: [] };
  if (!Array.isArray(entry.senses) || !entry.senses.length) return { reason: 'missingSenses', words: [] };
  const senses = entry.senses.filter(sense => !metadataIssue(sense));
  if (!senses.length) return { reason: 'excludedSenses', words: [] };
  const candidates = [{ form: entry.word }, ...(entry.forms || [])];
  const words = new Set();
  for (const form of candidates) {
    if (typeof form.form !== 'string' || metadataIssue(form) || rejectionReason(form.form)) continue;
    words.add(normalizeWord(form.form));
  }
  return { reason: null, words: [...words] };
}

export function classifyWord(word, { reference, blocked, accepted }) {
  if (blocked.has(word)) return 'bloqueada';
  if (reference.has(word)) return 'confirmada';
  if (accepted.has(word)) return 'excecao_da_casa';
  // Não estar nas referências não comprova erro. Nunca se transforma este
  // resultado em exclusão automática ou em uma afirmação de palavra inválida.
  return 'nao_confirmada';
}

export function sourceLinks(evidence) {
  return evidence.map(({ source, lemma }) => {
    const info = AUDIT.sources.find(item => item.id === source);
    if (!info) throw Error(`Fonte desconhecida: ${source}`);
    return { source, lemma, url: info.wiki + encodeURIComponent(lemma) };
  });
}

// Percorre todo o corpus, sem amostragem, normalizando só depois dos filtros da
// grafia original. A lista da casa e o bloqueio mantêm precedência explícita.
export async function auditEntries(entries, { reference, blocked, accepted, onRecord = () => {}, onAddition = () => {} }) {
  const seen = new Set();
  const counts = { examined: 0, baseWords: 0, confirmed: 0, houseExceptions: 0, unconfirmed: 0, blocked: 0, additions: 0, rejected: {}, duplicates: 0 };
  const samples = {};
  async function visit(word, addition = false) {
    if (seen.has(word)) { counts.duplicates++; return; }
    seen.add(word);
    const status = classifyWord(word, { reference, blocked, accepted });
    const record = { word, status };
    if (status === 'confirmada') record.evidence = sourceLinks(reference.get(word));
    counts.examined++;
    if (status === 'bloqueada') counts.blocked++;
    else if (addition) counts.additions++;
    else {
      counts.baseWords++;
      if (status === 'confirmada') counts.confirmed++;
      else if (status === 'excecao_da_casa') counts.houseExceptions++;
      else counts.unconfirmed++;
    }
    if ((samples[status] ||= []).length < AUDIT.examplesPerStatus) samples[status].push(word);
    if (addition) { record.origin = 'referencia'; await onAddition(record); }
    await onRecord(record);
  }
  for await (const raw of entries) {
    if (!raw.trim()) continue;
    const reason = rejectionReason(raw);
    if (reason) { counts.rejected[reason] = (counts.rejected[reason] || 0) + 1; continue; }
    await visit(normalizeWord(raw));
  }
  for (const word of accepted) await visit(word);
  for (const word of reference.keys()) if (!seen.has(word) && !blocked.has(word)) await visit(word, true);
  return { counts, samples, finalWords: counts.baseWords + counts.additions, seen };
}
