# Capiletras

Um jogo de cartas de letras online, para **2 a 8 pessoas**, em tempo real. Cada participante vê apenas a própria mão. Na sua vez, acrescente uma letra à palavra da mesa; vence quem esvaziar a mão primeiro. Interface em português do Brasil, adaptada a celular e desktop.

## Rodar localmente

Requer **Node.js 22 ou 24** e npm. Na raiz do repositório:

```bash
npm install && npm start
```

Abra `http://localhost:3000`. Crie uma sala, compartilhe o código ou copie o convite e entre com outro navegador/dispositivo. Para testar duas pessoas na mesma máquina, use uma janela normal e outra anônima: abas do mesmo perfil compartilham a identidade, e a aba mais recente retoma a mesma vaga.

O anfitrião configura jogadores e cartas iniciais, salva a configuração e clica em **Iniciar partida**. É preciso que todos os jogadores configurados estejam conectados. Não há cadastro, credenciais, banco de dados ou serviços externos obrigatórios.

```bash
npm test             # testes de regras, armazenamento, HTTP e Socket.IO
npm run dev          # reinicia o servidor ao editar os arquivos do servidor
```

Para executar os testes de interface com dois jogadores em navegadores isolados, incluindo cancelamento dos modais e tela de celular:

```bash
npx playwright install chromium  # uma vez, para baixar o navegador de teste
npm run test:browser
```

Se já houver Chromium instalado, use `CHROMIUM_EXECUTABLE_PATH=/caminho/do/chromium npm run test:browser`. Os testes iniciam o próprio servidor em uma porta livre e não alteram salas de um servidor em uso.

O front-end é estático: recarregue o navegador após editá-lo. Não há etapa de compilação. Para uma instalação exata a partir do lockfile, use `npm ci`. A porta usa `process.env.PORT`, com padrão `3000`; a mesma porta serve os arquivos e o Socket.IO. `GET /health` responde HTTP 200 com `{"status":"ok"}`.

## Configurar o baralho

No lobby, abra **Baralho**. Só o anfitrião edita as quantidades pelos botões **− / +** ou pelo campo numérico (confirme com Enter ou saindo do campo). As alterações válidas são salvas imediatamente e aparecem em tempo real para os demais participantes, em modo leitura. O total aparece no cabeçalho da seção. **Restaurar padrão** repõe as quantidades abaixo, sem mudar o número de jogadores.

| Tipo configurável | Padrão |
| --- | ---: |
| Coringa * | 12 |
| Vida ❤️ | 0 |
| Passar letra → | 8 |
| Troca 🔄 | 6 |
| Bloqueio ➕🚫 | 6 |
| 2x | 6 |
| 2+* | 4 |
| Jogar na vez do outro ⚔️ | 4 |

As **26 letras e quatro restritivas** são fixas (30 cartas). Cada tipo configurável aceita inteiros de **0 a 30**, com limite de **150 cartas no total**. Todos podem ser zerados; nesse caso o baralho tem 30 cartas. O padrão configurado é **76 cartas** (30 fixas + 46 configuráveis) com três ou mais participantes; com exatamente **2 participantes reais**, o baralho efetivo tem **72 cartas**, pois a espada entra com quantidade 0. A Vida começa em **0** e continua disponível para adicionar pelo controle do lobby. Quantidades inválidas são rejeitadas pelo servidor sem modificar a sala; o início fica indisponível com o motivo indicado.

A mão inicial padrão é de **7 cartas**, definida em `RULES.defaultHand`. Mudar a composição ou o número de jogadores recalcula `floor((total - 1) / jogadores)` como máximo de cartas iniciais. Se a mão escolhida ultrapassar esse valor, ela é reduzida automaticamente, com aviso ao anfitrião. O início também valida a distribuição e a reserva de compra. A composição é travada durante a partida e preservada em **Jogar de novo** e no retorno à sala. Com exatamente dois participantes reais (humanos + bots, independentemente do limite configurado), o controle da espada fica desabilitado com o aviso **“Indisponível em partidas de 2 jogadores”**. Seu valor escolhido é preservado; volta a valer quando o terceiro entra. O total efetivo e o máximo inicial recalculam também ao entrar ou sair alguém do lobby. Ao iniciar, `game.deckComposition` congela a composição efetiva: uma saída durante a partida não retira espadas já distribuídas.

Padrões e limites ficam em **`game/config.js`**: `CONFIGURABLE_CARD_TYPES`, `DEFAULT_DECK_COMPOSITION` (derivado de `CARD_TYPES`), `DECK_RULES`, `deckSize()` e `maxInitialCards()`. As validações puras ficam em **`game/deck.js`**; a composição JSON fica em **`room.settings.deckComposition`** e é salva pela mesma interface de storage. Salas antigas sem esse campo usam o padrão. Composições salvas antes da espada mantêm as demais quantidades e usam espada em 0 até o anfitrião editar ou restaurar o padrão. O servidor monta o baralho a partir dela, sem mudar as regras das cartas, o reembaralhamento, a votação ou a política dos bots.

Na mesa, **Comprar** e **Duvidar da palavra** ficam lado a lado. A mão mantém os tamanhos das cartas e uma faixa própria, sem rolagem vertical da página; mãos grandes rolam horizontalmente; os avatares dos adversários cabem juntos no topo, inclusive com oito participantes em 360px. Em telas baixas, o cabeçalho decorativo cede espaço ao jogo e a área do visor pode rolar internamente para mostrar palavras/avisos longos. O botão **Não consigo jogar** aparece junto da mão sem deslocar as cartas ou o centro.

## Jogar com bots

No lobby, o anfitrião pode usar **Adicionar bot** quantas vezes quiser, até o limite de **8 participantes no total**. O botão **×** ao lado de cada bot remove sua vaga antes de iniciar. Bots têm nomes automáticos únicos **Bot 1, Bot 2, Bot 3…**, sempre reutilizando o menor número livre na sala (nomes antigos salvos continuam válidos), e ícone 🤖 no lobby, na mesa e na indicação da vez. Ao preencher todas as vagas, adicionar outro bot aumenta o número configurado de participantes; se necessário, as cartas iniciais são reduzidas ao máximo permitido pela composição escolhida para a sala. Remover um bot de uma sala cheia também reduz a quantidade de vagas, respeitando o mínimo de dois jogadores.

É possível jogar com **1 humano e até 7 bots**, em um único nível de dificuldade. Bots não têm socket, ficam conectados no estado e nunca assumem o papel de anfitrião. Quando todos os humanos usam **Sair da sala**, a sala é removida e os agendamentos são cancelados. Uma queda de conexão reserva a vaga humana para reconexão: sem humanos conectados, os bots pausam; ao reconectar, retomam. Salas abandonadas continuam sujeitas à expiração.

O bot recebe somente a **própria mão e a visão pública**, exatamente como um cliente. Para escolher letras, sorteia o modo **comum (90%)** ou **erudito (10%)**, uma vez por decisão. O comum considera só prefixos da lista comum; sem opção, recorre ao completo, sem sortear o modo novamente. Depois de aplicar Bloqueio e restrições, monta todas as opções e sorteia uniformemente, sem favorecer ordem alfabética, inserção na trie, frequência ou repetição de letras. Isso vale para cartas simples, Vida, Troca, Bloqueio, pagamento de débito e espada. Para `2+*` e completar um desafio, sorteia uma palavra candidata e usa o trecho que falta, dentro do limite de 16 letras. A prévia escolhida no desafio é confirmada sem novo sorteio.

O dicionário **completo continua sendo o único usado para julgar** prefixos, palavras e votos contra bots; a lista comum só orienta a escolha de letras. O bot mantém a preferência por palavra completa ao baixar a última carta. Sem continuação nos dois léxicos, compra se puder; depois usa uma defesa ou blefa. Para evitar ciclos de recompra da mesma carta, o blefe prefere gastar cartas antigas. **Não consigo jogar** só é usado quando a validação normal o permite. Chances e regras de dúvida, votação e uso da espada permanecem iguais.

Os bots podem duvidar tanto de humanos quanto de outros bots, **somente quando o visor não é prefixo válido** e o desafio está permitido. Cada bot sorteia uma única vez por jogada que coloca letra: **35% no jogo normal** e **75% durante vitória pendente**. Um sorteio desfavorável na janela final deixa o bot aguardando; ele não aceita uma palavra suspeita. Com prefixo válido, aceita a vitória pendente e nunca duvida. Na votação, **todos os bots aceitam a palavra de um humano depois do OK**, inclusive o bot desafiante; contra outro bot, votam conforme a palavra completa no dicionário. Como desafiado, o bot mostra uma continuação real de até 16 letras e confirma, ou usa PERDI se não encontrar uma palavra.

Configuração em **`bots/config.js`**:

| Constante | Padrão |
| --- | --- |
| `BOT_NAME_PREFIX` | Prefixo “Bot”; usa o menor número disponível. |
| `actionMinMs` / `actionMaxMs` | 5.000 / 13.000 ms para jogar, comprar, Não consigo jogar, duvidar, espada e completar palavra. |
| `finalDoubtMinMs` / `finalDoubtMaxMs` | 1.000 / 8.000 ms para decidir duvidar na janela final de 10 segundos. |
| `deadlineMarginMs` | 250 ms de margem: o agendamento respeita o prazo absoluto restante ao restaurar/retomar desafios. |
| `responseMinMs` / `responseMaxMs` | 500 / 1.500 ms para votar ou aceitar a palavra. |
| `CHANCE_BOT_ESPADA` | 0,20; usada por `BOT_RULES.swordChance` fora da vez. |
| `CHANCE_BOT_ERUDITO` | 0,10; usada por `BOT_RULES.eruditeChance` uma vez por decisão de letras. |
| `commonMinFrequency` | 1.000 ocorrências na fonte para entrar na lista comum; não pondera escolhas. |
| `CHANCE_BOT_DUVIDAR` / `CHANCE_BOT_DUVIDAR_ULTIMA_CARTA` | 0,35 / 0,75; usados por `BOT_RULES.challengeChance` / `finalChallengeChance`. |
| `maxAttemptsPerTurn` | 3 tentativas antes da ação de segurança. |
| `maxContinuations`, `maxSearchNodes` | 48 e 20.000 nas consultas limitadas. As buscas `allContinuations` / `allExtensions` da escolha de letras são completas, sem esses cortes, para não enviesar sorteios. |
| `minWordLength` / `recentDrawBluffPenalty` | Mínimo de 3 letras no dicionário / preferência por cartas antigas em blefes. |

O cérebro puro fica em **`bots/brain.js`**, com RNG injetável para testes. **`bots/actions.js`** despacha as intenções para as mesmas funções puras de jogada, compra, desafio e votação usadas pelos humanos. Os timers ficam em **`network/bots.js`**, usam a mesma fila por sala dos sockets e descartam ações cuja versão ficou antiga. O limite de tentativas recorre às opções legais de segurança, sem passar a vez fora das regras. Salas restauradas refazem os agendamentos; o JSON guarda apenas `isBot`, dados normais do jogador, `game.letterPlayNumber`, `game.botDecisions`, `game.playNumber` e `game.botSwordDecisions`, que impedem novos sorteios na mesma jogada. Nenhum timer, função ou referência ao dicionário entra no estado.

### Fonte e licença do dicionário

Incluímos **317.673 palavras** normalizadas do corpus [fserb/pt-br](https://github.com/fserb/pt-br), de Fernando Serboncini, sob **licença MIT**. Foram combinados o léxico e as **conjugações verbais** do snapshot `93ba2a6f3b2f85262fba72df09d448c6bb2fa50a`. As entradas ficam em maiúsculas, sem acentos nem cedilha, apenas A–Z; palavras de menos de três letras ou com espaços/hífens são descartadas, assim como duplicatas. A atribuição, os links de origem e o hash estão em **`bots/data/SOURCE.md`**; a licença integral acompanha os dados em **`bots/data/LICENSE-MIT.txt`**.

O servidor carrega **`bots/data/pt-BR.txt`** uma vez na inicialização, em um trie compacto de vetores tipados, só em memória. Esse é o **dicionário completo**, mantido para todas as decisões sobre existência de palavra ou prefixo: duvidar, aceitar vitória pendente e votar quando Y é bot. Uma palavra ausente da lista comum continua válida para essas decisões se existir no completo.

A **lista comum** usa [FrequencyWords, de Hermit Dave](https://github.com/hermitdave/FrequencyWords), português brasileiro do corpus **OpenSubtitles2018 / OPUS**, sob **CC BY-SA 4.0**. A cópia original de 50.000 entradas com contagens fica em `bots/data/pt-BR-frequency.txt`. Na inicialização, `bots/load-dictionary.js` filtra entradas com pelo menos `BOT_RULES.commonMinFrequency` ocorrências, normaliza como o completo, remove duplicatas e mantém a interseção com ele: **11.304 palavras** com a configuração atual. Os pesos só filtram palavras raras; não são usados nos sorteios. Fonte, snapshot, atribuição e transformações estão em **`bots/data/SOURCE-COMMON.md`**; a licença integral está em **`bots/data/LICENSE-CC-BY-SA-4.0.txt`**.

Os dois tries ficam só em memória; nenhum dicionário, peso ou modo sorteado entra no estado salvo das salas. Não é necessário acesso à rede na inicialização. Os dicionários são recursos dos bots: **não mudam a regra de votação nem impõem validação automática às palavras dos humanos**.

## Avatares e som

As caixinhas do topo mostram um avatar e a quantidade de cartas, sem o nome fixo. Humanos usam uma ou duas iniciais e uma cor estável derivada do identificador; bots mantêm o robô. Toque, foco ou passar o mouse exibe o nome completo por 2,4 segundos. A borda destaca quem está na vez e a marca discreta indica desconexão. A faixa se adapta ao número de participantes, sem rolagem horizontal. `public/avatars.js` centraliza os auxiliares e o tempo do balão.

O som é inteiramente **original, sintetizado por código com Web Audio API**: ruído filtrado, osciladores e envelopes. Não há arquivos de áudio, músicas, cantos ou gravações de terceiros. `public/audio/sound.js` mantém um único AudioContext e só inicia após toque/clique ou tecla do usuário. O apito toca somente quando a vez chega ao jogador local, inclusive no retorno do 2x, sem repetir em atualizações da mesma vez. Cartas têm batida (mais discreta para os outros), compras têm deslize, modais têm abertura/fechamento suaves e botões têm clique.

Durante a partida há murmúrio de estádio com ondulação lenta e pad grave, quase imperceptíveis. Um desafio troca o ambiente por pulsação grave e notas dissonantes, com maior tensão nos últimos segundos; ao terminar, volta ao ambiente. Vitória pendente mantém o ambiente. As trocas usam fades. A aba em segundo plano suspende o contexto; ao voltar, um aviso de vez que ficou pendente só toca se ainda for a vez local.

O controle **🔊/🔇** e o volume geral permanecem acessíveis também nos modais. Preferências ficam apenas no `localStorage` (`capiletras:audio`); padrão ligado, volume geral 55%, ambiente muito baixo. **Volumes, fades, durações e intervalo de atualização** estão em `public/audio/config.js` (`AUDIO`). Falta de suporte ou bloqueio de áudio não impede o jogo. Não há eventos de rede, áudio no servidor ou alterações no estado da partida.

## Tema visual: campo de futebol

A mesa usa faixas de gramado com linha do meio e círculo central discretos. Lobby, botões e modais mantêm a estrutura, com painéis claros e tipografia **Georgia**, seguida por Times New Roman e serifa do sistema como fallback. Não há download de fontes ou imagens externas. Os versos marrons mostram uma capivara em **SVG inline original**, também nas mãos dos adversários; a bomba da `2+*` é outro SVG original.

A paleta e os tamanhos ficam nas variáveis de **`public/styles.css`**, no `:root` e nas substituições para celular em `@media (max-width: 650px)`:

| Variáveis | Uso / padrão |
| --- | --- |
| `--campo-verde`, `--campo-faixa`, `--campo-linhas` | Gramado `#167647` / `#106339` e linhas brancas translúcidas. |
| `--campo-listra`, `--campo-circulo` | Largura das faixas e raio do círculo do campo. |
| `--pagina`, `--painel`, `--texto`, `--texto-secundario` | Fundo claro, superfícies e textos de apoio. |
| `--fonte-interface`, `--fonte-base`, `--peso-titulo`, `--peso-destaque` | Família em serifa, escala tipográfica e pesos 800/700. |
| `--carta-neon`, `--carta-verde-escuro` | Cartas de adicionar: verde neon `#b9ff62` com texto verde escuro `#173e23`. |
| `--carta-azul-neon`, `--carta-azul-escuro` | Troca azul neon com símbolo 🔄. |
| `--carta-vermelho` | Texto e bomba da `2+*` sobre verde neon. |
| `--double-background`, `--double-border`, `--double-ink`, `--double-cyan`, `--double-violet`, `--double-pink`, `--double-glow` | 2x preta com texto serifado grande, contorno ciano/violeta/rosa e brilho suave; sem ícones nos cantos. A miniatura no lobby segue o mesmo visual. |
| `--block-card-*`, `--life-card-*`, `--pass-card-*`, `--pass-arrow-gradient` | Mantêm as cores de Bloqueio, Vida e Passar letra; Passar letra tem também seta no canto superior direito. |
| `--carta-verso`, `--carta-verso-borda`, `--capivara-*` | Marrom `#69412c`, borda bege e cores da ilustração do verso. |
| `--carta-largura`, `--carta-altura`, `--carta-fonte-*`, `--verso-*` | Frentes de **92 × 127 px** no desktop e **70 × 100 px** no celular, como antes; tamanhos das letras, símbolos e versos. |

As letras fixas, o coringa e as restritivas têm `+` no canto; as restritivas mostram “vogal”, “consoante”, “a-m” e “n-z”. O Bloqueio mostra 🚫 no centro e `+` no canto. Cartas desabilitadas ficam esmaecidas e sem brilho; hover e seleção mantêm o comportamento. A arte fica nos componentes de renderização em `public/app.js`, separada da configuração de regras do servidor. O tema não altera regras nem a arte das cartas. A composição padrão tem **76 cartas** (72 com dois participantes), e as quantidades escolhidas pelo anfitrião valem para a sala.

## Como jogar

- O baralho **padrão** tem **76 cartas** com três ou mais participantes, ou **72** com dois (sem espadas): **26 letras fixas, 4 restritivas, 12 coringas, 6 Trocas, 6 Bloqueios, 6 cartas 2x, 4 cartas `2+*`, 8 cartas Passar letra e 4 cartas Jogar na vez do outro**. Vida tem quantidade padrão **0**. O anfitrião pode personalizar os oito tipos especiais no lobby; as letras e as restritivas são fixas.
- O padrão de cartas iniciais é **7** e o mínimo é 3. O máximo é `floor((tamanhoDoBaralho - reservaDeCompra) / jogadores)`. A reserva padrão é 1: com o baralho padrão, são até **35 cartas para 2 jogadores** ou **9 para 8**. O total é calculado a partir da composição salva na sala, somada às cartas fixas; a interface recebe os limites e os padrões de `game/config.js`.
- Na sua vez, você pode comprar **no máximo uma carta**, opcionalmente. Comprar não passa a vez: baixe uma carta, inclusive a recém-comprada. Sem comprar, também pode jogar diretamente.
- Cartas fixas acrescentam sua letra. Nas demais, um seletor habilita somente as letras válidas. As escolhas vão de A a Z, sem acentos; Y é tratado como consoante.
- **Não consigo jogar** só fica disponível para quem está na vez, tem cartas e não consegue jogar nenhuma delas. Passar letra e Vida são jogáveis com pelo menos duas cartas na mão; como carta única também ficam indisponíveis. Antes de usar o botão, é obrigatório comprar a carta opcional deste turno. A exceção é quando baralho e descarte estão vazios: sem carta jogável, pode passar sem comprar. Se a carta comprada for jogável, o botão permanece desabilitado. O contador de compras zera em todo novo turno, inclusive no turno forçado e no retorno do 2x. O servidor rejeita o clique antecipado sem alterar o estado. Ele não fica disponível durante desafio ou vitória pendente.
- Ao usar **Não consigo jogar**, compre até 4 cartas, zere palavra, Bloqueio e débito e **perca a vez**, mesmo que as cartas compradas sejam jogáveis. No turno forçado de 2x, a vez retorna ao autor do 2x conforme a pilha de retornos. O histórico da última carta é apagado: 2x só pode voltar a ser jogado depois de outra carta nova. Se não existir compra nem descarte, a vez passa **sem alterar a palavra**. O PERDI dentro do desafio mantém suas regras próprias.
- Se a pilha acabar, as cartas já jogadas são embaralhadas e voltam para compra, sem apagar a palavra. Se nem o descarte tiver cartas, a compra é desabilitada. Se restarem menos de 4 cartas disponíveis para uma penalidade, compram-se todas as disponíveis, sem criar cartas extras.
- A última carta com letra abre uma **vitória pendente de 10 segundos**, descrita abaixo. **Vida, espada, Passar letra e 2x não podem ser a única carta jogada**: ficam desabilitadas quando a mão tem uma só carta. Toda vitória passa pela janela de dúvida. Depois da vitória confirmada, os demais podem aguardar a revanche ou sair para o início.

A mesa **não valida palavras em dicionário**. Para contestar a palavra, use **Duvidar da palavra**. O botão **Não consigo jogar** serve exclusivamente para uma mão sem carta jogável.

Acima do visor, **“É a vez de: Nome”** acompanha as trocas de turno em tempo real. O nome aparece em negrito e cor de destaque, com borda discreta para quem está na própria vez. Durante desafio e vitória pendente, o nome é mantido; na tela final, o rótulo passa a **“Vitória de Nome”**. Nomes longos quebram linha sem alargar a mesa.

O aviso de ação mais recente aparece **logo abaixo do visor**, substituindo a frase de apoio e a antiga posição abaixo de Duvidar da palavra. O título “Capiletras · a mesa é de todos” foi removido. A linha externa de status e “Turno N” também não aparecem. A mão mostra apenas **Sua mão** e a quantidade de cartas, sem “Suas possibilidades”, dicas ao lado/abaixo ou rodapé na tela da mesa. O indicador **É a vez de: Nome** permanece no visor. Mensagens longas quebram linha e têm rolagem limitada, sem alargar a mesa; os avisos continuam até a próxima atualização, como antes.

**Não consigo jogar** fica junto da mão e só existe na interface quando o servidor informa que pode ser usado, com a conexão disponível. Nas demais situações ele some, sem motivo de desabilitação nem espaço reservado. Ocupa uma camada à direita do título da mão, sem inserir uma linha, cobrir as cartas ou deslocar a mesa e a fileira de cartas.

### Cartas novas

| Carta | Quantidade padrão | Cor e símbolo | Efeito |
| --- | ---: | --- | --- |
| Troca | 6 | Azul neon, 🔄 | Escolha A–Z para **substituir a última letra** por outra. Sem débito, exige visor preenchido e respeita bloqueios. Com débito, primeiro entram as acumuladas e a última delas é substituída; vale mesmo com visor inicialmente vazio. |
| Bloqueio | 6 | Vermelha, ➕🚫 | Escolha uma letra para adicionar e outra para bloquear até a **próxima jogada que adiciona ou substitui letra**. Os seletores são independentes: pode bloquear a própria letra adicionada. |
| 2x | 6 | Preta, 2x em contorno ciano/violeta/rosa | Não muda o visor. Quem baixou a carta imediatamente anterior joga novamente; depois, o autor do 2x recebe um novo turno com nova compra opcional. Só então a ordem normal continua. Não vale antes da primeira jogada. |
| 2+* | 4 | Verde neon, bomba vermelha e 2+* no canto | Digite duas ou mais letras para acrescentar à palavra. Só a primeira respeita o Bloqueio ativo. |
| Vida | 0 | Rosa, ❤️ | Só vogais: escolha A, E, I, O ou U e adicione ao visor. Depois, o autor fica protegido contra desafios. |
| Jogar na vez do outro | 4 | Preta, espada vertical em gradiente e + | Coringa apenas fora da vez; adiciona letra sem mudar turno nem compra. |
| Passar letra | 8 | Preta, seta → em gradiente | Não usa letra: passa a vez e transfere ao próximo o débito anterior acrescido de uma letra. Sempre jogável, inclusive como primeira carta. |

### Jogar na vez do outro ⚔️

A espada é um coringa **exclusivo de fora da própria vez**. Escolha A–Z no modal: a letra entra no fim do visor, respeitando e consumindo o Bloqueio. O aviso é **“Fulano jogou na vez de Beltrano ⚔️”**. O dono da espada vira o último jogador a baixar carta e o autor da última letra, portanto é o desafiado em uma dúvida seguinte.

A vez, o contador de compra e a pilha de retornos de 2x **não mudam**. Se havia uma escolha de carta aberta, o cliente fecha os modais e avisa que a mesa mudou; a carta continua na mão. Espadas são validadas contra o **estado atual**, mesmo se o pedido trouxe uma versão antiga: várias espadas válidas entram em ordem de chegada e todas acrescentam sua letra. O segundo pedido consecutivo do mesmo autor é rejeitado, pois ele virou o último a jogar. As cartas normais da vez continuam usando a versão para cancelar escolhas antigas. O modal da espada permanece aberto, com **visor e Bloqueio atualizados em tempo real**; uma letra que ficou inválida é rejeitada sem gastar a carta e permite escolher outra. Os avisos das espadas são apresentados em ordem, por `RULES.actionNoticeMs` (1.200 ms cada). Várias espadas cancelam a escolha do jogador da vez uma única vez e não repetem esse aviso.

A carta fica indisponível quando é a única da mão, na própria vez (inclusive forçada), para quem baixou a última carta, com qualquer débito pendente, durante desafio/vitória pendente ou após o fim. Um outro jogador precisa baixar uma carta antes de o mesmo autor poder usar outra espada. Reset do desafio e **Não consigo jogar** limpam o último jogador; depois deles, quem está fora da vez e tem pelo menos duas cartas pode usar a carta. Na própria vez, ter só espadas não impede **Não consigo jogar**, seguindo a compra prévia habitual.

Uma espada no meio de um 2x mantém o alvo forçado e o retorno. Um 2x jogado depois dela chama o dono da espada, salvo se outra carta foi jogada nesse intervalo. A espada encerra a proteção da Vida. Não cria nem paga débito. A espada não pode ser a última carta e nunca abre uma vitória por si só.

São **4 por padrão**, configuráveis de 0 a 30 como os demais tipos; as outras quantidades não mudam. A frente preta tem `+`, espada vertical em **SVG inline original** com gradiente dourado/laranja/magenta e legenda “jogue na vez do outro”. As variáveis `--sword-card-*`, `--sword-gold`, `--sword-orange`, `--sword-magenta`, `--sword-art-height` e `--sword-caption-font` ficam em `public/styles.css`.

Bots esperam o atraso normal de 5–13 segundos e sorteiam `CHANCE_BOT_ESPADA = 0.2` **uma única vez por bot e por carta baixada**, incluindo 2x e Passar letra. Só usam a espada com uma letra permitida que mantenha prefixo válido do dicionário. `game.playNumber` conta essas jogadas e `game.botSwordDecisions` registra a decisão privada por bot; ambos são JSON, persistidos sem timers nem dicionário. Comprar, receber estado e reconectar não geram novo sorteio. A versão antiga cancela a ação agendada e faz o bot replanejar.

### Letras acumuladas: Passar letra

Cada **Passar letra** acrescenta uma letra ao débito de quem recebe a vez. Se Ana joga Passar letra e Bia responde com outra, Caio deve **2 letras**. A palavra permanece igual e o Bloqueio ativo continua. A carta é jogável com pelo menos duas cartas na mão, inclusive na primeira jogada; não pode ser a última.

Antes de jogar uma carta que adiciona ou substitui letra (fixa, coringa, restritiva, Troca, Bloqueio, Vida ou `2+*`), o devedor preenche **exatamente N letras** no modal **Letras acumuladas**. Essas letras são livres de A a Z, independentemente das restrições da carta. O campo normaliza para maiúsculas e remove caracteres inválidos; o servidor rejeita entradas com espaços, números, acentos ou símbolos. O modal mostra contador, prévia e, quando necessário, a letra bloqueada. Depois vem a escolha normal da carta; uma carta fixa já tem sua própria letra definida.

O envio é **uma única jogada atômica**: cancelar o pagamento ou qualquer modal seguinte mantém carta, palavra, bloqueio, débito e vez. O servidor revalida todas as escolhas antes de salvar. Se a mesa mudar durante a escolha, os modais fecham para que o jogador confira o novo estado.

A ordem no visor é **palavra atual + letras acumuladas + efeito da carta**. Exemplo: palavra `CA`, débito 2, pagamento `SO` e carta fixa `R` resultam em `CASOR`. A Troca substitui a última acumulada por uma letra diferente: com visor vazio, pagamento `AB` e Troca para `C`, o resultado é `AC`. O pagamento zera o débito e permite abrir vitória pendente ao baixar uma última carta permitida.

Com Bloqueio, **só a primeira letra acumulada não pode ser a bloqueada**; as demais são livres. O pagamento consome o Bloqueio antes da carta: com K bloqueado e débito 2, `AK` + carta fixa K é válido e produz `AKK`. A letra própria da Vida continua sendo vogal e o texto próprio da `2+*` continua exigindo 2 a 16 letras, mas não sofrem mais aquele bloqueio. Uma nova carta Bloqueio instala a nova restrição depois do pagamento.

**2x e Passar letra não pagam o débito.** No 2x, ele acompanha quem é forçado a jogar de novo. Se esse jogador usar Passar letra, soma mais uma e devolve o débito ao autor do 2x; nas cadeias de 2x, ele sempre acompanha quem vai jogar, respeitando a pilha de retornos. Comprar uma carta não paga nem aumenta o débito. **Não consigo jogar e PERDI do desafio zeram todo o débito**, além de zerar a palavra e cancelar o Bloqueio, e avisam a mesa. A proteção da Vida contra desafios continua restrita ao seu autor.

O centro da mesa mostra **“Fulano deve N letras”** para todos. O estado `game.letterDebt = { count, playerId }` é JSON serializável; ele acompanha também passagens por desconexão. Quantidade padrão (`8`) e acréscimo (`1`) ficam em `CARD_TYPES.pass`, em `game/config.js`. O preto e as cores da seta são ajustáveis nas variáveis `--pass-card-background` e `--pass-arrow-gradient` de `public/styles.css`.

### Outras interações

A carta `2+*` é um coringa de várias letras: digite uma sequência de **2 a 16 letras de A a Z**. Todas entram no final do visor, na ordem digitada, em maiúsculas. O modal remove espaços, números, acentos e símbolos enquanto você digita; o servidor rejeita esses caracteres se forem enviados diretamente. Não há validação por dicionário. A quantidade padrão (`4`), o mínimo (`2`) e o máximo (`16`) são constantes em `CARD_TYPES.multi`, em `game/config.js`.

O modal mostra contador, prévia da palavra e confirmação habilitada apenas com uma sequência válida. Sob Bloqueio, **só a primeira letra não pode ser a bloqueada**: com A bloqueado, `BAAA` é válido e `AB` não é. Da segunda posição em diante, a letra bloqueada é permitida. A carta continua jogável sob qualquer Bloqueio e sua jogada consome a restrição. Ela conta como uma jogada normal para o próximo 2x e a janela de vitória ao esvaziar a mão. No celular, o modal se ajusta à área visível ao abrir o teclado; o conteúdo rola e o botão de confirmação fica separado dessa rolagem. Palavras e prévias longas quebram linha e têm rolagem própria.

A **Vida ❤️ — só vogais** fica fora do baralho padrão; o anfitrião pode incluí-la no lobby. Quando incluída, permite escolher apenas **A, E, I, O ou U**, inclusive com o visor vazio. As consoantes ficam desabilitadas no modal e são rejeitadas novamente pelo servidor, sem alterar o estado. Se o Bloqueio for de uma vogal, ela fica indisponível e sobram as outras quatro; um Bloqueio de consoante não muda as cinco opções. A Vida consome o Bloqueio ao ser jogada em ambos os casos. Como sempre sobram pelo menos quatro vogais, a carta permanece jogável. A Vida não pode ser jogada como carta única: compre antes de usá-la.

A Vida protege seu autor **contra Duvidar da palavra**. Comprar não encerra a proteção. A próxima carta jogada encerra a marca anterior; outra Vida passa a proteger seu novo autor. A proteção também termina quando a vez volta ao autor. Ela não interfere em **Não consigo jogar** e não aparece no botão da mesa.

Um **2x logo depois da Vida** encerra a proteção e força o autor a jogar de novo. Sua próxima carta segue as regras normais. Vida continua indisponível se for a única carta da mão.

A marca `game.protectedPlayerId` é JSON serializável e salva junto da partida. O servidor rejeita o desafio contra o protegido sem alterar a sala; o cliente apenas apresenta o estado. Quantidade e regra ficam em `CARD_TYPES.life`, em `game/config.js`. O rosa e o contraste do coração são ajustáveis em `public/styles.css`, nas variáveis `--life-card-background`, `--life-card-border` e `--life-card-ink`.

O bloqueio fica visível no centro da mesa. **Sem débito**, cartas fixas da letra bloqueada e essa letra em todos os seletores ficam desabilitadas. Comprar, desconectar ou jogar **2x ou Passar letra não consome nem cancela o bloqueio**. Ele permanece durante toda a cadeia e vale para qualquer jogador, inclusive quem o criou se for forçado a jogar novamente. A carta 2x não usa letra e continua jogável sob bloqueio, respeitando a exigência de já existir uma jogada anterior. Só uma carta efetivamente jogada que **adiciona ou substitui letra** (letra fixa, coringa, restritiva, Troca, Bloqueio, 2+*, Vida ou espada) consome a restrição. Sem pagamento de débito, a letra adicionada por um novo Bloqueio ainda respeita o bloqueio anterior, e a nova restrição o substitui. Com pagamento, apenas a primeira acumulada respeita a restrição anterior. Não consigo jogar e o PERDI do desafio cancelam o bloqueio. A escolha de qual letra bloquear pode ser qualquer A–Z, mesmo a que estava bloqueada.

O 2x pode formar uma cadeia. Exemplo com a ordem normal Ana → Bia → Caio:

```text
Ana joga → Bia joga 2x → Ana joga 2x → Bia joga
         → Ana joga → Bia joga → Caio joga normalmente
```

Cada seta inicia um novo turno com o contador de compra zerado. Os retornos ficam numa pilha serializável (`game.extraTurns`). Se um participante envolvido desconectar, seu turno é pulado conforme a política de conexão existente. **Não consigo jogar** apaga o histórico da última carta e impede 2x até uma nova carta; o reset do desafio também limpa esse histórico, liberando a espada fora da vez e exigindo uma nova carta antes de 2x. 2x também exige pelo menos duas cartas na mão.

As cartas injogáveis ficam esmaecidas e desabilitadas, e as opções são recalculadas quando mão, visor, bloqueio, débito ou vez mudam. O servidor valida as mesmas condições. Cada clique de **Não consigo jogar** inclui a versão da mesa: um clique repetido sobre o estado anterior é rejeitado sem duplicar a penalidade.

## Duvidar da palavra

O botão fica no centro da mesa e qualquer participante conectado pode usá-lo, inclusive fora da vez, durante a partida. O desafio não altera a composição escolhida para a sala. O servidor aceita apenas o primeiro desafio e rejeita os demais sem alterar a sala; o aviso de rejeição chega só a quem clicou. Também rejeita visor vazio, desafio à própria palavra e desafio a alguém protegido pela Vida, com o aviso **“Fulano está protegido pela Vida”**. Depois de uma vitória, não é possível desafiar.

**Só é permitido iniciar um desafio sem débito de letras acumuladas.** Enquanto alguém deve uma ou mais letras de Passar letra, o botão fica desabilitado para todos, com o motivo **“Há letras acumuladas pendentes”**. O servidor também valida a restrição e responde somente a quem tentou: **“Não dá para duvidar: Fulano ainda deve N letras”**, sem salvar nem publicar um novo estado. O **2x transfere o débito**, mantendo o impedimento. Pagar todas as letras em uma jogada ou zerá-las em uma penalidade zera o débito e recalcula o botão para todos. As regras anteriores continuam valendo: após zerar o visor, por exemplo, o visor vazio impede o desafio até alguém adicionar uma nova letra.

O desafiado é **quem adicionou ou substituiu a última letra do visor**, incluindo pagamento de letras acumuladas. **2x e Passar letra não mudam esse autor**. Esse histórico fica em `game.lastLetterPlayerId`, separado do último jogador que baixou uma carta, usado pelo 2x e pela trava de uso consecutivo da espada.

Ao iniciar, as escolhas de cartas em andamento são canceladas, sem retirar cartas das mãos. Todos veem o desafio; jogadas, compras e o botão Não consigo jogar ficam suspensos. O servidor também rejeita jogadas enviadas com uma versão antiga da mesa, inclusive se chegarem depois do reset.

1. **Completar — 30 segundos.** Todos veem quem desafiou quem e a palavra. Só o desafiado edita: pode acrescentar **de 0 a 16 letras de A a Z**, convertidas para maiúsculas, sempre ao final. As letras são livres, não respeitam nem consomem o Bloqueio e não pagam o débito de Passar letra. A prévia chega aos demais em tempo real. Ele escolhe **OK**, inclusive sem acrescentar nada, ou **PERDI**. Se não usar OK até o fim dos 30 segundos, o servidor aplica **PERDI imediatamente**, descartando as letras digitadas. O modal mostra esse aviso com o tempo restante.
2. **Votar — até 15 segundos.** Após OK, todos os participantes da rodada, **exceto o desafiado**, votam em “Aceitar palavra?”. O desafiante também vota. Cada um responde uma única vez. Estar desconectado sem ter votado conta como **Sim imediatamente**; não responder até o prazo também conta como Sim. Votos já registrados permanecem. O modal mostra a palavra, o tempo e os botões, sem progresso, contagens ou nomes de votantes. Cada cliente recebe somente o próprio voto; ao reconectar, sua escolha continua marcada e não pode ser repetida. O desafiado acompanha a palavra e o tempo sem votar.
3. **Resultado.** Com **50% ou mais de Não** entre os votantes, a palavra é recusada; caso contrário, é aceita. Para `N` votantes, o servidor continua encerrando assim que `Não × 2 >= N` (recusa) ou `(Não + pendentes) × 2 < N` (aceitação garantida). Entre seis votantes, três Não recusam e quatro Sim aceitam imediatamente; três Sim e três pendentes ainda exigem espera. Em uma partida com duas pessoas, há um único votante e sua resposta decide. A interface recebe e mostra apenas **“Palavra aceita”** ou **“Palavra recusada”**. Votos individuais, totais, progresso e detalhes do encerramento ficam internos ao servidor, inclusive depois do resultado. Votos atrasados não alteram o resultado.

Se a palavra for **aceita**, o desafiante compra até **4 cartas**. Se for **recusada**, o servidor aplica **PERDI imediatamente** ao desafiado. Se ele desconectar ou sair durante qualquer etapa, o PERDI também é automático imediatamente. Não há prazo adicional de 10 segundos. Em qualquer penalidade, o descarte pode ser reembaralhado e compram-se apenas as cartas disponíveis, como nas regras existentes. O PERDI manual do modal pertence exclusivamente ao desafiado e só está disponível durante a fase de completar, antes do OK; o botão da mesa tem outras regras.

**Desafios comuns fazem reset total da mesa:** zeram palavra, débito, Bloqueio, proteção da Vida e os históricos de quem adicionou letra e de quem baixou a última carta. Mantêm a vez, a compra opcional e os retornos de 2x. Não existe janela de PERDI para o último jogador; o botão da mesa só depende da mão sem carta jogável de quem está na vez. Depois do reset não há palavra para desafiar. **A exceção é a palavra aceita durante vitória pendente:** confirma a vitória e preserva a palavra completa na tela final. Se a vitória pendente for cancelada, há reset total e a jogada termina, passando a vez.

Os modais se ajustam ao espaço visível no celular e mantêm os botões fora da área de rolagem. **Não têm botão X e não podem ser fechados por clique fora, Esc ou voltar do celular**: só o servidor encerra a fase. Não existe mais voto por fechar o modal. Atualizar a página ou reconectar recupera a fase, o prazo restante, a prévia e o voto já registrado. Os modais de jogar cartas continuam permitindo cancelar. Se o jogador da vez desconectar durante o desafio, a resolução preserva sua vez; a mesa pode aguardar a reconexão ou o anfitrião pode encerrar a partida pausada.

As regras e os tempos estão em **`CHALLENGE_RULES`, em `game/config.js`**; a compra da penalidade usa `RULES.lossPenalty`. A lógica pura fica em **`game/challenge.js`**, recebendo horário e aleatoriedade como argumentos. `game.challenge` guarda fase (`completando` ou `votando`), ids, palavra inicial, letras acrescentadas, votantes, votos e **prazos absolutos em milissegundos**. Não há fase nem prazo de espera por PERDI. `game.challengeResult` guarda internamente o resultado completo mais recente. Ambos são JSON serializáveis e salvos pela mesma interface de armazenamento. **`network/client-view.js`** filtra o transporte para os clientes: o desafio inclui apenas `ownVote` sobre os votos, e o resultado expõe somente `outcome` (`aceita`/`recusada`). Contagens de aceites da janela de vitória também não são enviadas nem mostradas. As contagens internas, o encerramento antecipado e a visão usada pelos bots permanecem iguais.

A rede verifica os prazos antes das ações e em uma varredura periódica, inclusive ao iniciar com salas restauradas, sem depender de um timer antigo em memória ou de haver clientes conectados. Uma sala restaurada já vencida é resolvida imediatamente: não recebe outros 30 ou 15 segundos. Salas antigas na fase de espera por PERDI também são resolvidas de imediato, e os campos antigos desse prazo são removidos. Testes usam um relógio injetado para verificar os limites exatos e a restauração sem esperas longas.

## Última carta e vitória pendente

Ao baixar a última carta fixa, coringa, restritiva, Troca, Bloqueio ou `2+*`, a jogada é aplicada por inteiro, incluindo pagamento de letras acumuladas. A carta vai para o descarte e a mão fica vazia, mas a partida aguarda **10 segundos**. Todos veem o contador **“Fulano baixou a última carta. Vitória em Xs, a menos que alguém duvide”**. Jogadas, compras e Não consigo jogar ficam travados.

Cada outro jogador pode usar **Aceito a palavra** uma única vez. Desconectados contam como aceitos; se todos aceitarem, a vitória é confirmada antecipadamente. Sem desafio até o fim do prazo, o jogador vence. A palavra final é preservada na tela de vitória e o servidor rejeita ações posteriores de jogo e novos desafios.

Qualquer outro participante pode duvidar durante a janela, respeitando as restrições atuais (visor preenchido, débito zerado, autor sem proteção da Vida e nenhum desafio em andamento). O desafio substitui a janela: o prazo original não confirma vitória enquanto o desafio ocorre. Se a palavra for aceita, o desafiante compra até 4 cartas e o autor da última carta **vence**, com a palavra completa no resultado final. Se for recusada ou houver PERDI manual/automático do desafiado, ele compra até 4 cartas, a vitória é cancelada e a mesa é zerada (palavra, débito, Bloqueio, proteção e autor da última letra). A carta jogada não volta à mão; a jogada termina e a vez passa, respeitando retornos de 2x já pendentes.

**Vida, espada, 2x e Passar letra não podem ser jogadas como última carta.** A regra fica em `CARD_TYPES.*.cannotBeLast` e `RULES.minHandForRestrictedCards` (2). Compre a carta opcional para aumentar a mão; depois aplica-se a jogabilidade normal, inclusive no turno forçado. A espada permanece exclusiva de fora da própria vez. Se não houver compra nem descarte, continua válida a exceção de segurança de **Não consigo jogar**, que passa a vez preservando o visor. Ao tocar numa dessas cartas únicas, o aviso é **“Compre uma carta para poder jogar esta”**; não há novo texto fixo na mão. Os bots usam a mesma validação, compram quando ficam só com uma delas e não tentam vencer com essas cartas. Não há mais vitória imediata.

O estado `game.pendingVictory` contém `playerId`, `deadline` absoluto, identificador da janela, votantes e `acceptedIds`. O prazo fica em `RULES.victoryWindowMs`, em `game/config.js`. A lógica pura de aceite e resolução fica em `game/victory.js`. A varredura do servidor resolve também janelas restauradas já vencidas, sem depender de um timer antigo em memória. Os ids de sessão, mãos adversárias e baralho continuam privados.

## Desconexão e duração das salas

A identidade aleatória do jogador e o código da sala são guardados no `localStorage`. O Socket.IO reconecta automaticamente; ao recarregar pelo mesmo navegador, a vaga e as cartas são recuperadas. Não compartilhe seu armazenamento local: a identidade funciona como chave de retomada, não como uma conta autenticada.

Jogadores desconectados mantêm as cartas, mas têm seus turnos pulados. Se o jogador da vez desconectar, a vez passa e começa um novo contador de compras. Com menos de dois conectados, a partida pausa. O anfitrião é transferido para alguém conectado, quando possível. Ele pode esperar os outros voltarem ou encerrar uma partida pausada e voltar ao lobby. No lobby, pode liberar a vaga de um desconectado.

Sair pelo botão **Sair da sala** é uma saída voluntária: durante a partida a mão permanece reservada fora da rotação, e a pessoa não retoma essa rodada. Uma queda de conexão, por outro lado, permite retomar. Na revanche, quem saiu é removido e é preciso completar a quantidade configurada ou voltar ao lobby para ajustá-la.

A limpeza roda a cada minuto. Salas sem ninguém conectado expiram após **30 minutos**; salas sem ações por **6 horas** também são removidas. As constantes ficam em `game/config.js`.

## Deploy no Render

`package.json` e `render.yaml` estão **na raiz**. É um único Web Service Node, sem front-end separado. Para publicar com o Blueprint:

1. Acesse [Render](https://render.com), entre na sua conta e conecte o GitHub.
2. Escolha **New → Blueprint** e autorize o repositório `felipeferreiramarques90-web/capiletras-v2`.
3. Selecione a branch **main**. O Render encontrará o `render.yaml` da raiz.
4. Revise e crie o serviço. O Blueprint define Node 22, `buildCommand: npm install`, `startCommand: npm start` e `healthCheckPath: /health`.
5. Aguarde o deploy concluir e abra o endereço HTTPS fornecido pelo Render. Crie uma sala e teste com outro navegador.

Também é possível usar **New → Web Service**, conectar o mesmo repositório e preencher: runtime **Node**, branch **main**, Root Directory **vazio**, Build Command **`npm install`**, Start Command **`npm start`**, Health Check Path **`/health`**. Use Node 22 (variável `NODE_VERSION=22`). O Render fornece a variável `PORT` automaticamente. Não é necessário configurar uma URL separada de WebSocket.

**No plano gratuito do Render, o serviço pode dormir por inatividade e o primeiro acesso pode demorar cerca de um minuto.** Como as salas ficam em memória, reinícios, novos deploys e suspensão do processo podem apagar as partidas. Avise o grupo para criar uma nova sala quando isso acontecer. Mantenha uma única instância neste MVP.

O repositório e o Blueprint preparam o deploy; conectar e criar o serviço no Render é uma etapa feita na sua conta.

## Organização do código

```text
game/config.js       Regras ajustáveis, tipos de carta e limites
game/game.js         Lógica pura, validações e visão privada de cada jogador
game/challenge.js    Desafios, votação, penalidades e resolução pura de prazos
game/victory.js      Janela de vitória, aceite unânime e prazos persistidos
bots/brain.js        Decisões dos bots com visão privada e RNG injetável
bots/actions.js      Despacho para as mesmas validações puras dos humanos
bots/players.js      Inclusão e remoção de bots no lobby
bots/dictionary.js   Trie e buscas por prefixo, palavra e continuação
bots/load-dictionary.js Carregamento dos léxicos completo e comum, só em memória
bots/data/           Léxico completo (MIT), frequências pt-BR (CC BY-SA 4.0) e atribuições
storage/memory.js    Interface assíncrona de armazenamento, implementada em memória
network/socket.js    Eventos Socket.IO, identificação, filas por sala e limpeza
network/client-view.js Filtro de privacidade dos votos e avisos enviados ao cliente
network/bots.js      Atrasos, descarte de ações antigas e retomada dos bots
server.js            Express, arquivos estáticos e rota /health
public/              Interface em HTML, CSS e JavaScript, sem compilação
test/                Testes automatizados com o runner nativo do Node.js
browser-test/        Testes reais de cartas, desafios, modais e celular com Playwright
render.yaml          Blueprint do Render
```

A lógica não depende de Socket.IO, armazenamento ou relógio global: recebe a aleatoriedade e o horário como argumentos quando necessário, devolvendo um novo estado. Sala e partida são objetos serializáveis em JSON, sem funções, Sets ou ciclos. Todas as ações são validadas no servidor e salvas antes do envio dos estados. O cliente recebe apenas campos públicos, a contagem dos adversários e a própria mão; identificadores de sessão, cartas adversárias e a ordem do baralho não são enviados.

As filas por sala evitam conflitos entre compras, jogadas e reconexões simultâneas no mesmo processo. A identidade de retomada não é o ID público do jogador. O servidor também limita tamanho e frequência de mensagens. Ajuste as regras em `game/config.js`, em especial a composição e os efeitos em `CARD_TYPES`, `maxDrawsPerTurn`, `lossPenalty`, os limites de jogadores e as durações de expiração.

## Trocar a memória por um banco de dados

Substitua a implementação de **`storage/memory.js`**, preservando seu `export default` e esta interface:

```js
await storage.getRoom(code);    // objeto da sala ou null
await storage.saveRoom(room);  // insere/substitui a sala, identificada por room.code
await storage.deleteRoom(code);
await storage.listRooms();     // array com os objetos das salas
```

Cada método deve devolver uma Promise, trabalhar com cópias independentes e aceitar o estado JSON completo, incluindo mãos e identificadores privados. Essa camada é interna ao servidor: não exponha esses dados em endpoints públicos. É possível usar uma coluna JSON no PostgreSQL ou um documento por código em outro banco; faça o upsert de forma atômica. Mantenha também a exportação nomeada `MemoryStorage` para os testes isolados, ou mova essa classe para um arquivo de apoio aos testes. A lógica do jogo e os eventos não precisam mudar para trocar o armazenamento em um único processo.

Persistir o estado não substitui os sockets ativos: o cliente precisa reconectar e os indicadores de conexão salvos precisam ser normalizados ao iniciar um novo processo. Para **várias instâncias**, será necessário também um adaptador compartilhado do Socket.IO, roteamento de sessões e bloqueio/transações distribuídos por sala; as filas locais do MVP não bastam.
