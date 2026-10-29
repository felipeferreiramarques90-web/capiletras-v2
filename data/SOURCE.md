# Dicionário completo: Hunspell pt-BR / VERO

Fonte: [VERO, no repositório LibreOffice/dictionaries](https://github.com/LibreOffice/dictionaries/tree/4f1df64b2e8e14751aa7c2205d170ca016071315/pt_BR).
Autor: Raimundo Santos Moura e colaboradores, copyright 2006–2013.
Versão: **3.3.0**, conforme `description.xml`; o cabeçalho de `pt_BR.aff` informa 3.2.
Snapshot: `4f1df64b2e8e14751aa7c2205d170ca016071315`.

A distribuição declara LGPLv3 e Mozilla Public License. Nesta distribuição,
utilizamos os dados sob **LGPL versão 3**. A declaração original acompanha os
arquivos em `hunspell/LICENSE-VERO.txt`; os textos integrais LGPLv3 e GPLv3
(incorporado pela LGPL) estão em `hunspell/LICENSE-LGPL-3.0.txt` e
`hunspell/LICENSE-GPL-3.0.txt`. Os `.dic`, `.aff` e `description.xml` foram
preservados sem alterações. O script de expansão é fornecido com o aplicativo.

Geração inicial: **2026-10-29T03:03:57.403Z (UTC)**. O manifesto
`dictionary-build.json` registra data, hashes das fontes e estatísticas.
`npm run dict:build` expande flags UTF-8, prefixos/sufixos, cruzamentos Y/Y e
classes de continuação usadas neste snapshot. Nomes, siglas e entradas inválidas
são descartados antes de expandir, evitando transformar nomes em falsas palavras
minúsculas via prefixação. As formas geradas são filtradas novamente antes de
compactar. A grafia original permanece no arquivo gerado para revalidar na carga.

`pt-BR-forms.txt.gz` é o resultado derivado, sob a mesma licença: 2.711.928
formas elegíveis antes da normalização e das listas da casa, em aproximadamente
6,8 MiB. A carga remove duplicatas após normalizar, aplica as listas e produz
**2.613.061 palavras** com as listas iniciais. O comum tem **13.669 palavras**.
Nenhum dado lexical ou relatório entra no estado JSON das salas ou no cliente.

As contagens de descarte somam entradas do `.dic` rejeitadas antes da expansão,
formas distintas geradas rejeitadas no build e rejeições durante a carga.
Cada entrada rejeitada recebe um único motivo; siglas são contabilizadas antes
de maiúscula inicial porque ambas as regras as rejeitariam. A contagem de bloqueio
é de grafias efetivamente removidas, não do tamanho da lista de bloqueio.

As listas da casa são aplicadas na inicialização, sem precisar refazer o build.
O bloqueio prevalece sobre exceções. O léxico comum mantém a fonte de frequências
CC BY-SA 4.0, com a mesma política e interseção obrigatória com o completo.
