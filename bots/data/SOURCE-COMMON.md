# Lista comum pt-BR dos bots

Fonte: [FrequencyWords, de Hermit Dave](https://github.com/hermitdave/FrequencyWords),
arquivo `content/2018/pt_br/pt_br_50k.txt`, gerado do corpus
[OpenSubtitles2018 / OPUS](https://opus.nlpl.eu/OpenSubtitles/v2018.php).

Snapshot: `525f9b560de45753a5ea01069454e72e9aa541c6`.
[Dados originais](https://github.com/hermitdave/FrequencyWords/blob/525f9b560de45753a5ea01069454e72e9aa541c6/content/2018/pt_br/pt_br_50k.txt).
O conteúdo é **CC BY-SA 4.0**, conforme a
[declaração de licença da fonte](https://github.com/hermitdave/FrequencyWords/blob/525f9b560de45753a5ea01069454e72e9aa541c6/README.md#license).
A licença integral acompanha os dados em [LICENSE-CC-BY-SA-4.0.txt](LICENSE-CC-BY-SA-4.0.txt).
Esta lista e suas adaptações permanecem sob CC BY-SA 4.0, com atribuição a
Hermit Dave e à fonte OpenSubtitles / OPUS. Essa licença dos dados não substitui
a licença MIT do dicionário completo, que é um recurso separado.

`pt-BR-frequency.txt` é uma cópia **sem alterações** das 50.000 linhas da fonte,
no formato `palavra ocorrências`. SHA-256:
`a61d6f2ede97c5daad5fb3907b72a228f0aff12668be6d24da590d20804fa611`.

Transformações **somente em memória**, ao iniciar o servidor:

- Descartar entradas abaixo de `BOT_RULES.commonMinFrequency` (padrão: 1.000 ocorrências).
- Aplicar a mesma normalização do léxico completo: NFD, remover acentos/cedilha,
  maiúsculas, apenas A–Z, mínimo de três letras; deduplicar.
- Manter apenas palavras que também existem no dicionário completo. Isso evita
  que ruídos, nomes ou termos estrangeiros das legendas ampliem o léxico julgador.

Resultado com os padrões atuais: **11.304 palavras**. As frequências servem só
para o filtro de inclusão; não são guardadas no trie, não ponderam sorteios e
não entram no estado JSON. Não há download em tempo de execução.
