# Dicionário pt-BR dos bots

Fonte: [fserb/pt-br](https://github.com/fserb/pt-br), Fernando Serboncini.
Licença **MIT**, preservada integralmente em [LICENSE-MIT.txt](LICENSE-MIT.txt).

Snapshot: `93ba2a6f3b2f85262fba72df09d448c6bb2fa50a`.
Arquivos de origem:

- [lexico](https://github.com/fserb/pt-br/blob/93ba2a6f3b2f85262fba72df09d448c6bb2fa50a/lexico)
- [conjugações](https://github.com/fserb/pt-br/blob/93ba2a6f3b2f85262fba72df09d448c6bb2fa50a/conjuga%C3%A7%C3%B5es)

Transformação: remover espaços das extremidades, decompor Unicode (NFD), remover
marcas de acentuação, converter para maiúsculas, descartar entradas que não
contenham apenas A–Z ou tenham menos de três letras, remover duplicatas e ordenar.
Não são separados componentes de palavras com hífen ou espaços.

Resultado: **317.673 entradas**, incluindo formas verbais conjugadas.
SHA-256 de `pt-BR.txt`:
`39bcb7a89d1eea1950aa96c05b5d5d28df656ed8335305331d317d71b32a21a5`.

Este arquivo acompanha o app. O servidor não precisa baixar dados na inicialização.
