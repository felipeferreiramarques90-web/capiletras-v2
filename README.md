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

## Como jogar

- O baralho tem **84 cartas**: as 42 originais (26 letras fixas, 12 coringas verdes e as 4 cartas restritivas), mais **8 Trocas, 6 Bloqueios e 6 cartas 2x**, além de **5 cartas `2+*`, 5 cartas Vida e 12 cartas Passar letra**. As quantidades dos tipos anteriores permanecem iguais.
- O mínimo de cartas iniciais é 3. O máximo é `floor((tamanhoDoBaralho - reservaDeCompra) / jogadores)`. A reserva padrão é 1: são até **41 cartas para 2 jogadores** ou **10 para 8**. O tamanho do baralho é calculado a partir das quantidades em `CARD_TYPES`, em `game/config.js`; a interface recebe a mesma configuração do servidor.
- Na sua vez, você pode comprar **no máximo uma carta**, opcionalmente. Comprar não passa a vez: baixe uma carta, inclusive a recém-comprada. Sem comprar, também pode jogar diretamente.
- Cartas fixas acrescentam sua letra. Nas demais, um seletor habilita somente as letras válidas. As escolhas vão de A a Z, sem acentos; Y é tratado como consoante.
- **PERDI** pode ser usado por quem baixou a última carta (inclusive 2x e Passar letra), enquanto ninguém ainda tiver jogado depois, **ou por quem está na vez sem nenhuma carta jogável**. A proteção da Vida continua valendo. Não é preciso comprar antes; a compra opcional continua disponível e pode trazer uma carta jogável. A penalidade compra até 4 cartas, zera a palavra e o débito de letras, cancela o bloqueio e mantém a vez e o contador de compras de quem já estava jogando. A penalidade independe da compra opcional. O último jogador perde sua janela depois de um PERDI, mas quem continua na vez sem carta jogável pode usar novamente.
- Se, depois do PERDI, o jogador da vez continuar sem carta jogável e não restar compra nem descarte, a vez passa para o próximo, respeitando retornos pendentes de 2x. **A palavra é zerada antes dessa passagem**, inclusive se já não havia cartas para comprar. Não há compra extra nem passagem automática por uma mão injogável: a passagem excepcional só ocorre ao usar PERDI.
- Se a pilha acabar, as cartas já jogadas são embaralhadas e voltam para compra, sem apagar a palavra. Se nem o descarte tiver cartas, a compra é desabilitada. Se restarem menos de 4 cartas disponíveis para uma penalidade, compram-se todas as disponíveis, sem criar cartas extras.
- Ao baixar a última carta, a vitória é imediata e não há mais PERDI. Todos veem o resultado; o anfitrião pode começar uma revanche ou voltar à sala. Os demais podem aguardar ou sair para o início.

A mesa **não valida palavras em dicionário**. O grupo combina quando uma sequência não tem continuação e usa PERDI ou **Duvidar da palavra**, com votação entre os participantes.

### Cartas novas

| Carta | Quantidade | Cor e símbolo | Efeito |
| --- | ---: | --- | --- |
| Troca | 8 | Azul clara, 🔄 | Escolha A–Z para **substituir a última letra** por outra. Sem débito, exige visor preenchido e respeita bloqueios. Com débito, primeiro entram as acumuladas e a última delas é substituída; vale mesmo com visor inicialmente vazio. |
| Bloqueio | 6 | Vermelha, ➕🚫 | Escolha uma letra para adicionar e outra para bloquear até a **próxima jogada que adiciona ou substitui letra**. Os seletores são independentes: pode bloquear a própria letra adicionada. |
| 2x | 6 | Laranja, 2x | Não muda o visor. Quem baixou a carta imediatamente anterior joga novamente; depois, o autor do 2x recebe um novo turno com nova compra opcional. Só então a ordem normal continua. Não vale antes da primeira jogada. |
| 2+* | 5 | Lilás, 2+* | Digite duas ou mais letras para acrescentar à palavra. Só a primeira respeita o Bloqueio ativo. |
| Vida | 5 | Rosa, ❤️ | Só vogais: escolha A, E, I, O ou U e adicione ao visor. Depois, o autor fica impedido de usar PERDI nessa janela. |
| Passar letra | 12 | Preta, seta → em gradiente | Não usa letra: passa a vez e transfere ao próximo o débito anterior acrescido de uma letra. Sempre jogável, inclusive como primeira carta. |

### Letras acumuladas: Passar letra

Cada **Passar letra** acrescenta uma letra ao débito de quem recebe a vez. Se Ana joga Passar letra e Bia responde com outra, Caio deve **2 letras**. A palavra permanece igual e o Bloqueio ativo continua. A carta é sempre jogável, inclusive na primeira jogada; esvaziar a mão com ela vence normalmente.

Antes de jogar uma carta que adiciona ou substitui letra (fixa, coringa, restritiva, Troca, Bloqueio, Vida ou `2+*`), o devedor preenche **exatamente N letras** no modal **Letras acumuladas**. Essas letras são livres de A a Z, independentemente das restrições da carta. O campo normaliza para maiúsculas e remove caracteres inválidos; o servidor rejeita entradas com espaços, números, acentos ou símbolos. O modal mostra contador, prévia e, quando necessário, a letra bloqueada. Depois vem a escolha normal da carta; uma carta fixa já tem sua própria letra definida.

O envio é **uma única jogada atômica**: cancelar o pagamento ou qualquer modal seguinte mantém carta, palavra, bloqueio, débito e vez. O servidor revalida todas as escolhas antes de salvar. Se a mesa mudar durante a escolha, os modais fecham para que o jogador confira o novo estado.

A ordem no visor é **palavra atual + letras acumuladas + efeito da carta**. Exemplo: palavra `CA`, débito 2, pagamento `SO` e carta fixa `R` resultam em `CASOR`. A Troca substitui a última acumulada por uma letra diferente: com visor vazio, pagamento `AB` e Troca para `C`, o resultado é `AC`. O pagamento zera o débito e permite vencer normalmente ao baixar a última carta.

Com Bloqueio, **só a primeira letra acumulada não pode ser a bloqueada**; as demais são livres. O pagamento consome o Bloqueio antes da carta: com K bloqueado e débito 2, `AK` + carta fixa K é válido e produz `AKK`. A letra própria da Vida continua sendo vogal e o texto próprio da `2+*` continua exigindo 2 a 16 letras, mas não sofrem mais aquele bloqueio. Uma nova carta Bloqueio instala a nova restrição depois do pagamento.

**2x e Passar letra não pagam o débito.** No 2x, ele acompanha quem é forçado a jogar de novo. Se esse jogador usar Passar letra, soma mais uma e devolve o débito ao autor do 2x; nas cadeias de 2x, ele sempre acompanha quem vai jogar, respeitando a pilha de retornos. Comprar uma carta não paga nem aumenta o débito. **PERDI zera todo o débito**, além de zerar a palavra e cancelar o Bloqueio, e avisa a mesa. A proteção da Vida continua restrita ao seu autor.

O centro da mesa mostra **“Fulano deve N letras”** para todos. O estado `game.letterDebt = { count, playerId }` é JSON serializável; ele acompanha também passagens por desconexão. Quantidade (`12`) e acréscimo (`1`) ficam em `CARD_TYPES.pass`, em `game/config.js`. O preto e as cores da seta são ajustáveis nas variáveis `--pass-card-background` e `--pass-arrow-gradient` de `public/styles.css`.

### Outras interações

A carta `2+*` é um coringa de várias letras: digite uma sequência de **2 a 16 letras de A a Z**. Todas entram no final do visor, na ordem digitada, em maiúsculas. O modal remove espaços, números, acentos e símbolos enquanto você digita; o servidor rejeita esses caracteres se forem enviados diretamente. Não há validação por dicionário. A quantidade (`5`), o mínimo (`2`) e o máximo (`16`) são constantes em `CARD_TYPES.multi`, em `game/config.js`.

O modal mostra contador, prévia da palavra e confirmação habilitada apenas com uma sequência válida. Sob Bloqueio, **só a primeira letra não pode ser a bloqueada**: com A bloqueado, `BAAA` é válido e `AB` não é. Da segunda posição em diante, a letra bloqueada é permitida. A carta continua jogável sob qualquer Bloqueio e sua jogada consome a restrição. Ela conta como uma jogada normal para o último jogador, PERDI, o próximo 2x e vitória ao esvaziar a mão. No celular, o modal se ajusta à área visível ao abrir o teclado; o conteúdo rola e o botão de confirmação fica separado dessa rolagem. Palavras e prévias longas quebram linha e têm rolagem própria.

A **Vida ❤️ — só vogais** permite escolher apenas **A, E, I, O ou U**, inclusive com o visor vazio. As consoantes ficam desabilitadas no modal e são rejeitadas novamente pelo servidor, sem alterar o estado. Se o Bloqueio for de uma vogal, ela fica indisponível e sobram as outras quatro; um Bloqueio de consoante não muda as cinco opções. A Vida consome o Bloqueio ao ser jogada em ambos os casos. Como sempre sobram pelo menos quatro vogais, a carta permanece jogável. Baixar a última carta com Vida vence normalmente.

Depois da Vida, **apenas o PERDI do seu autor fica desabilitado**, com o aviso “Protegido pela Vida”. Se o próximo jogador tiver cartas jogáveis, ninguém pode dizer PERDI nessa janela; o caso de **jogador da vez sem carta jogável continua permitido para o próximo jogador**. Comprar não encerra a proteção. Assim que outra carta é jogada, a marca anterior termina; uma nova Vida protege seu próprio autor. A proteção também termina quando a vez volta ao autor, inclusive se houve passagem por falta de cartas ou desconexão. O PERDI volta a seguir as regras normais nas próximas jogadas e nos próximos turnos.

Um **2x logo depois da Vida** encerra a proteção e força o autor a jogar de novo. A jogada seguinte desse autor pode dar direito ao PERDI normalmente, a menos que seja outra Vida. Um PERDI de outro jogador não conta como carta jogada e não limpa por si só a proteção.

A marca `game.protectedPlayerId` é JSON serializável e salva junto da partida. O servidor rejeita o PERDI do protegido sem alterar a sala; o cliente apenas apresenta o estado. Quantidade e regra ficam em `CARD_TYPES.life`, em `game/config.js`. O rosa e o contraste do coração são ajustáveis em `public/styles.css`, nas variáveis `--life-card-background`, `--life-card-border` e `--life-card-ink`.

O bloqueio fica visível no centro da mesa. **Sem débito**, cartas fixas da letra bloqueada e essa letra em todos os seletores ficam desabilitadas. Comprar, desconectar ou jogar **2x ou Passar letra não consome nem cancela o bloqueio**. Ele permanece durante toda a cadeia e vale para qualquer jogador, inclusive quem o criou se for forçado a jogar novamente. A carta 2x não usa letra e continua jogável sob bloqueio, respeitando a exigência de já existir uma jogada anterior. Só uma carta efetivamente jogada que **adiciona ou substitui letra** (letra fixa, coringa, restritiva, Troca, Bloqueio, 2+* ou Vida) consome a restrição. Sem pagamento de débito, a letra adicionada por um novo Bloqueio ainda respeita o bloqueio anterior, e a nova restrição o substitui. Com pagamento, apenas a primeira acumulada respeita a restrição anterior. Todo PERDI cancela o bloqueio. A escolha de qual letra bloquear pode ser qualquer A–Z, mesmo a que estava bloqueada.

O 2x pode formar uma cadeia. Exemplo com a ordem normal Ana → Bia → Caio:

```text
Ana joga → Bia joga 2x → Ana joga 2x → Bia joga
         → Ana joga → Bia joga → Caio joga normalmente
```

Cada seta inicia um novo turno com o contador de compra zerado. Os retornos ficam numa pilha serializável (`game.extraTurns`). Se um participante envolvido desconectar, seu turno é pulado conforme a política de conexão existente. PERDI não apaga o histórico da última carta: o 2x continua válido depois de o visor ser zerado. Baixar a última carta com 2x também vence imediatamente.

As cartas injogáveis ficam esmaecidas e desabilitadas, e as opções dos seletores são recalculadas quando a mão, o visor ou o bloqueio mudam. O servidor recalcula e valida as mesmas condições independentemente do cliente. Quando os dois casos de PERDI estão disponíveis, o primeiro clique aceito altera `game.version`; cliques com a versão anterior são rejeitados, evitando duas penalidades simultâneas. Se o botão continuar habilitado, um novo clique usa a nova versão.

## Duvidar da palavra

O botão fica no centro da mesa e qualquer participante conectado pode usá-lo, inclusive fora da vez, durante a partida. O baralho continua com **84 cartas**. O servidor aceita apenas o primeiro desafio e rejeita os demais sem alterar a sala; o aviso de rejeição chega só a quem clicou. Também rejeita visor vazio, desafio à própria palavra e desafio a alguém protegido pela Vida, com o aviso **“Fulano está protegido pela Vida”**. Depois de uma vitória, não é possível desafiar.

O desafiado é **quem adicionou ou substituiu a última letra do visor**, incluindo pagamento de letras acumuladas. **2x e Passar letra não mudam esse autor**. Esse histórico fica em `game.lastLetterPlayerId`, separado do último jogador que baixou uma carta, usado pelo PERDI e pelo 2x.

Ao iniciar, as escolhas de cartas em andamento são canceladas, sem retirar cartas das mãos. Todos veem o desafio; jogadas, compras e o PERDI normal ficam suspensos. O servidor também rejeita jogadas enviadas com uma versão antiga da mesa, inclusive se chegarem depois do reset.

1. **Completar — 30 segundos.** Todos veem quem desafiou quem e a palavra. Só o desafiado edita: pode acrescentar **de 0 a 16 letras de A a Z**, convertidas para maiúsculas, sempre ao final. As letras são livres, não respeitam nem consomem o Bloqueio e não pagam o débito de Passar letra. A prévia chega aos demais em tempo real. Ele escolhe **OK**, inclusive sem acrescentar nada, ou **PERDI**. Depois dos 30 segundos, não pode mais editar nem usar OK; só resta PERDI, com mais **10 segundos** antes da aplicação automática.
2. **Votar — 15 segundos.** Após OK, todos os participantes da rodada, **exceto o desafiado**, votam em “Aceitar palavra?”. O desafiante também vota. Cada um responde uma única vez. Fechar o modal, não responder no prazo ou estar desconectado sem ter votado conta como **Sim**. Votos já registrados permanecem. O jogo espera todos responderem ou o prazo terminar. Durante a votação só aparece a contagem de respostas; nenhum cliente recebe os votos dos outros. O desafiado vê que não vota e acompanha o progresso.
3. **Resultado.** Com **50% ou mais de Não** entre os votantes, a palavra é recusada; caso contrário, é aceita. Três Não entre seis votantes recusam; entre sete, são necessários quatro. Em uma partida com duas pessoas, há um único votante e seu Não recusa. Os votos individuais e os totais de Sim/Não são revelados no resultado.

Se a palavra for **aceita**, o desafiante compra até **4 cartas**. Se for **recusada**, o desafiado deve apertar **PERDI** em até **10 segundos**; depois, o servidor aplica automaticamente. Se o desafiado desconectar ou sair durante qualquer etapa, o PERDI é automático imediatamente. Em qualquer penalidade, o descarte pode ser reembaralhado e compram-se apenas as cartas disponíveis, como nas regras existentes. O PERDI do modal pertence exclusivamente ao desafiado e não depende da janela do PERDI normal.

**Todo fim de desafio faz um reset total da mesa:** zera a palavra inteira (o trecho anterior e as novas letras), o débito, o Bloqueio, a proteção da Vida e o histórico de quem adicionou letra. Fecha também a janela de PERDI do último jogador. A vez, o contador de compra opcional e os retornos pendentes de 2x continuam como estavam. Não há passagem automática por falta de carta jogável nesse reset; o PERDI de jogador da vez sem carta jogável continua seguindo sua regra normal depois dele. Não é possível duvidar de novo até outra carta colocar uma letra no visor. O resultado fica visível na mesa com os votos, a penalidade e o aviso de reset.

Os modais se ajustam ao espaço visível no celular e mantêm os botões fora da área de rolagem. Fechar o acompanhamento de um desafio não libera jogadas; use **Acompanhar desafio** para abri-lo novamente. Se o jogador da vez desconectar durante o desafio, a resolução preserva sua vez; a mesa pode aguardar a reconexão ou o anfitrião pode encerrar a partida pausada.

As regras e os tempos estão em **`CHALLENGE_RULES`, em `game/config.js`**; a compra da penalidade usa `RULES.lossPenalty`. A lógica pura fica em **`game/challenge.js`**, recebendo horário e aleatoriedade como argumentos. `game.challenge` guarda fase (`completando`, `votando` ou `perdi`), ids, palavra inicial, letras acrescentadas, votantes, votos e **prazos absolutos em milissegundos**. `game.challengeResult` guarda o resultado público mais recente. Ambos são JSON serializáveis e salvos pela mesma interface de armazenamento.

A rede verifica os prazos antes das ações e em uma varredura periódica, inclusive ao iniciar com salas restauradas, sem depender de um timer antigo em memória ou de haver clientes conectados. Uma sala restaurada já vencida segue os prazos originalmente salvos: não recebe outros 30, 15 ou 10 segundos. Testes usam um relógio injetado para verificar os limites exatos e a restauração sem esperas longas.

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
storage/memory.js    Interface assíncrona de armazenamento, implementada em memória
network/socket.js    Eventos Socket.IO, identificação, filas por sala e limpeza
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
