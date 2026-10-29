export const DICTIONARY = Object.freeze({
  source: new URL('../data/hunspell/pt_BR.dic', import.meta.url),
  affixes: new URL('../data/hunspell/pt_BR.aff', import.meta.url),
  generated: new URL('../data/pt-BR-forms.txt.gz', import.meta.url),
  manifest: new URL('../data/dictionary-build.json', import.meta.url),
  blocked: new URL('../data/bloqueio.txt', import.meta.url),
  accepted: new URL('../data/aceitas.txt', import.meta.url),
  frequency: new URL('./data/pt-BR-frequency.txt', import.meta.url),
  minLength: 3, maxAffixDepth: 2, trieInitialCapacity: 4096, trieGrowthFactor: 1.5,
  sourceVersion: 'VERO 3.3.0 (cabeçalho aff 3.2)',
  snapshot: '4f1df64b2e8e14751aa7c2205d170ca016071315',
});
