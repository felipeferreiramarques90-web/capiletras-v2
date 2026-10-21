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

O front-end é estático: recarregue o navegador após editá-lo. Não há etapa de compilação. Para uma instalação exata a partir do lockfile, use `npm ci`. A porta usa `process.env.PORT`, com padrão `3000`; a mesma porta serve os arquivos e o Socket.IO. `GET /health` responde HTTP 200 com `{"status":"ok"}`.

## Como jogar

- O baralho tem **62 cartas**: as 42 originais (26 letras fixas, 12 coringas verdes e as 4 cartas restritivas), mais **8 Trocas, 6 Bloqueios e 6 cartas 2x**.
- O mínimo de cartas iniciais é 3. O máximo é `floor((tamanhoDoBaralho - reservaDeCompra) / jogadores)`. A reserva padrão é 1: são até **30 cartas para 2 jogadores** ou **7 para 8**. O tamanho do baralho é calculado a partir das quantidades em `CARD_TYPES`, em `game/config.js`; a interface recebe a mesma configuração do servidor.
- Na sua vez, você pode comprar **no máximo uma carta**, opcionalmente. Comprar não passa a vez: baixe uma carta, inclusive a recém-comprada. Sem comprar, também pode jogar diretamente.
- Cartas fixas acrescentam sua letra. Nas demais, um seletor habilita somente as letras válidas. As escolhas vão de A a Z, sem acentos; Y é tratado como consoante.
- **PERDI** pode ser usado por quem baixou a última carta (inclusive 2x), enquanto ninguém ainda tiver jogado depois, **ou por quem está na vez sem nenhuma carta jogável**. Não é preciso comprar antes; a compra opcional continua disponível e pode trazer uma carta jogável. A penalidade compra até 4 cartas, zera a palavra, cancela o bloqueio e mantém a vez e o contador de compras de quem já estava jogando. A penalidade independe da compra opcional. O último jogador perde sua janela depois de um PERDI, mas quem continua na vez sem carta jogável pode usar novamente.
- Se, depois do PERDI, o jogador da vez continuar sem carta jogável e não restar compra nem descarte, a vez passa para o próximo, respeitando retornos pendentes de 2x. **A palavra é zerada antes dessa passagem**, inclusive se já não havia cartas para comprar. Não há compra extra nem passagem automática por uma mão injogável: a passagem excepcional só ocorre ao usar PERDI.
- Se a pilha acabar, as cartas já jogadas são embaralhadas e voltam para compra, sem apagar a palavra. Se nem o descarte tiver cartas, a compra é desabilitada. Se restarem menos de 4 cartas disponíveis para uma penalidade, compram-se todas as disponíveis, sem criar cartas extras.
- Ao baixar a última carta, a vitória é imediata e não há mais PERDI. Todos veem o resultado; o anfitrião pode começar uma revanche ou voltar à sala. Os demais podem aguardar ou sair para o início.

A mesa **não valida palavras em dicionário**. O grupo combina quando uma sequência não tem continuação e usa o botão PERDI.

### Cartas novas

| Carta | Quantidade | Cor e símbolo | Efeito |
| --- | ---: | --- | --- |
| Troca | 8 | Azul clara, 🔄 | Escolha A–Z para **substituir a última letra**, sem aumentar o comprimento. Não vale com visor vazio, não pode repetir a letra substituída e respeita bloqueios. |
| Bloqueio | 6 | Vermelha, ➕🚫 | Escolha uma letra para adicionar e outra para bloquear até a **próxima jogada que adiciona ou substitui letra**. Os seletores são independentes: pode bloquear a própria letra adicionada. |
| 2x | 6 | Laranja, 2x | Não muda o visor. Quem baixou a carta imediatamente anterior joga novamente; depois, o autor do 2x recebe um novo turno com nova compra opcional. Só então a ordem normal continua. Não vale antes da primeira jogada. |

O bloqueio fica visível no centro da mesa. Cartas fixas da letra bloqueada e essa letra em todos os seletores ficam desabilitadas. Comprar, desconectar ou jogar **2x não consome nem cancela o bloqueio**. Ele permanece durante toda a cadeia de 2x e vale para qualquer jogador, inclusive quem o criou se for forçado a jogar novamente. A carta 2x não usa letra e continua jogável sob bloqueio, respeitando a exigência de já existir uma jogada anterior. Só uma carta efetivamente jogada que **adiciona ou substitui letra** (letra fixa, coringa, restritiva, Troca ou Bloqueio) consome a restrição. Se essa carta for um novo Bloqueio, sua letra adicionada ainda respeita o bloqueio anterior e a nova restrição o substitui. Todo PERDI cancela o bloqueio. A escolha de qual letra bloquear pode ser qualquer A–Z, mesmo a que estava bloqueada.

O 2x pode formar uma cadeia. Exemplo com a ordem normal Ana → Bia → Caio:

```text
Ana joga → Bia joga 2x → Ana joga 2x → Bia joga
         → Ana joga → Bia joga → Caio joga normalmente
```

Cada seta inicia um novo turno com o contador de compra zerado. Os retornos ficam numa pilha serializável (`game.extraTurns`). Se um participante envolvido desconectar, seu turno é pulado conforme a política de conexão existente. PERDI não apaga o histórico da última carta: o 2x continua válido depois de o visor ser zerado. Baixar a última carta com 2x também vence imediatamente.

As cartas injogáveis ficam esmaecidas e desabilitadas, e as opções dos seletores são recalculadas quando a mão, o visor ou o bloqueio mudam. O servidor recalcula e valida as mesmas condições independentemente do cliente. Quando os dois casos de PERDI estão disponíveis, o primeiro clique aceito altera `game.version`; cliques com a versão anterior são rejeitados, evitando duas penalidades simultâneas. Se o botão continuar habilitado, um novo clique usa a nova versão.

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
storage/memory.js    Interface assíncrona de armazenamento, implementada em memória
network/socket.js    Eventos Socket.IO, identificação, filas por sala e limpeza
server.js            Express, arquivos estáticos e rota /health
public/              Interface em HTML, CSS e JavaScript, sem compilação
test/                Testes automatizados com o runner nativo do Node.js
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
