# Referência independente para auditoria automática

As duas extrações abaixo contêm verbetes em português do Wikcionário. Foram
obtidas por Kaikki/Wiktextract, de Tatu Ylonen e colaboradores. Os autores dos
verbetes são os colaboradores de cada edição do Wikcionário; seus históricos
podem ser consultados nos links de cada evidência.

- Edição portuguesa: https://kaikki.org/ptwiktionary/ ; dump de **01/10/2026**,
  extração de **02/11/2026**. JSONL bruto:
  https://kaikki.org/dictionary/downloads/pt/pt-extract.jsonl.gz
- Edição inglesa, somente a língua portuguesa:
  https://kaikki.org/dictionary/Portuguese/ ; dump de **01/10/2026**,
  extração de **30/10/2026**. JSONL disponibilizado por Kaikki:
  https://kaikki.org/dictionary/Portuguese/kaikki.org-dictionary-Portuguese.jsonl.gz
- Extrator: Wiktextract, revisão
  `19f9a3006a405fb7bfb40193dca41c7117a009a5`.

## Licença e atribuição

A fonte declara os dados sob as licenças do Wikcionário, CC BY-SA e GFDL:
https://kaikki.org/ptwiktionary/#copyright-and-license
https://en.wiktionary.org/wiki/Wiktionary:Copyrights
https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use

Distribuímos os extratos derivados **sob CC BY-SA 4.0**. O texto integral está em
`LICENSE-CC-BY-SA-4.0.txt`. Modificações: seleção de português, filtros de
metadados e grafia, normalização A–Z, deduplicação e extração das flexões
explicitamente fornecidas. Não são distribuídos exemplos, traduções ou definições.

`reference.tsv.gz` mantém, para cada palavra normalizada, uma evidência por
edição: código da fonte e verbete original. O relatório reconstrói URLs como
`https://pt.wiktionary.org/wiki/<verbete>` e
`https://en.wiktionary.org/wiki/<verbete>` (com codificação de URL), permitindo
consultar autoria e histórico. A normalização pode unir grafias com e sem acento;
é o mesmo critério A–Z do jogo.

Os arquivos e a licença do VERO/LGPL continuam separados em `data/hunspell/`.
Não reatribuímos a licença do VERO ao Wikcionário ou vice-versa.

## Filtros e revisão

São elegíveis somente verbetes/flexões em português, de classes lexicais
configuradas em `bots/dictionary-audit-config.js`. Antes de normalizar, rejeitamos
inicial maiúscula, siglas, hífen/apóstrofo/pontuação/espaços e palavras curtas.
Rejeitamos metadados de nome próprio, sigla, grafia incorreta/não padrão,
romanização, variantes explicitamente exclusivas de Portugal e avisos de
cabeçalho de idioma incorreto. Uma pronúncia portuguesa não torna uma palavra
exclusiva de Portugal: o filtro considera sentidos/formas, não pronúncias.

Os arquivos de origem não são versionados por seu tamanho. Os hashes SHA-256,
datas, contagens e descartes estão em `reference-manifest.json`; as URLs, hashes
esperados e limites são constantes. Se a URL tiver uma revisão diferente, a
importação falha e exige atualizar a configuração conscientemente. A referência
compacta versionada permite auditar sem baixar nada nem consultar milhões de
páginas. A auditoria não infere derivados: uma forma não documentada continua
não confirmada, salvo exceção explícita da casa.

`confirmed-additions.txt.gz` contém somente lacunas documentadas pelas referências.
`additions-manifest.json` registra seu hash, contagem, base e referência usadas.
`last-audit.json` é o resumo da última execução que publicou o suplemento.
O relatório completo por palavra é gerado em `reports/dictionary/` e publicado
como artefato pelo workflow do GitHub; não é enviado ao cliente nem ao storage.

Não confirmada **não significa inválida**. O modo padrão acrescenta lacunas
confirmadas e respeita os bloqueios explícitos da casa. O lote de 2.228.069
não confirmadas de 05/11/2026 foi incluído em `data/bloqueio.txt` a pedido da mesa;
`blocked-unconfirmed-import.json` registra a origem, as contagens e os hashes. `data/bloqueio.txt` prevalece
sobre todas as fontes e exceções. Não há certificação de correção semântica de
cada verbete; o relatório registra exatamente a evidência encontrada.
