# Wineguard — painel web

Painel React e Vite para consultar as leituras atuais e o histórico do sensor WineSensor002 pela API do backend Wineguard. O frontend acessa somente rotas relativas `/api/`; Orion, STH-Comet e MQTT não são acessados diretamente pelo navegador.

## Requisitos

- Node.js e npm instalados.
- Acesso ao backend Wineguard para visualizar dados reais.

## Executar localmente

```bash
npm install
```

Crie `.env.local` na raiz do projeto usando `.env.example` como modelo e informe a URL do backend:

```env
VITE_API_TARGET=http://<IP_DO_BACKEND>
VITE_API_TIMEOUT_MS=10000
VITE_API_REFRESH_INTERVAL_MS=30000
```

O Vite encaminha `/api` para o endereço configurado em `VITE_API_TARGET`. Esse destino deve encaminhar as rotas do backend Wineguard, incluindo `/api/auth` e `/api/sensors`; não aponte o frontend diretamente para a porta Java `8080`. O proxy fica desativado quando essa variável não está definida. `VITE_API_TIMEOUT_MS` configura o prazo por consulta e `VITE_API_REFRESH_INTERVAL_MS` configura a atualização das leituras e do histórico; ambos são milissegundos e usam os valores acima como padrão. `.env.local` é ignorado pelo Git; não publique nele o endereço da infraestrutura. Reinicie o servidor do Vite após alterar essa configuração:

```bash
npm run dev
```

O React usa rotas relativas `/api/`; a mesma origem deve encaminhar cada rota ao serviço correspondente. Não inclua o endereço do backend nas chamadas do navegador.

## Login e sessão

Ao abrir o painel, o frontend consulta `GET /api/auth/me`. Se a sessão não existir, apresenta o formulário de login. O envio busca `GET /api/auth/csrf`, envia usuário e senha como `application/x-www-form-urlencoded` para `POST /api/auth/login` e busca um token CSRF novo após o login. O usuário exibido vem da resposta de `/me`.

O cookie de sessão permanece gerenciado pelo navegador e é enviado com `credentials: same-origin`; o React não o lê nem o grava. O token CSRF fica somente em memória e é enviado no logout. Não há cadastro público ou recuperação de senha. Credenciais não são persistidas em localStorage, no código ou em variáveis `VITE_*`.

## APIs consultadas

- `GET /api/auth/csrf`, `POST /api/auth/login`, `GET /api/auth/me` e `POST /api/auth/logout`: autenticação por sessão e proteção CSRF.
- `GET /api/sensors/WineSensor002/readings`: leitura atual de temperatura, umidade, luminosidade LDR e data informada pela API.
- `GET /api/sensors/WineSensor002/history?attribute=<atributo>&limit=20`: até vinte pontos históricos, com `receivedAt` e `value`.

Os atributos históricos aceitos são `temperature`, `humidity` e `luminosity`; `limit` aceita valores de 1 a 100. A luminosidade é mostrada sem unidade física, pois a escala do LDR ainda não foi calibrada. Horários são exibidos no fuso local do navegador, com o identificador de fuso retornado por `Intl`.

As leituras atuais e o histórico são atualizados a cada 30 segundos sem sobreposição de requisições. Leituras e histórico têm estados independentes de carregamento, falha, timeout e ausência de dados; uma falha de atualização mantém visível a última resposta bem-sucedida. A navegação mobile oferece links diretos para as seções disponíveis. A sessão expira conforme a política do backend; operações de escrita futuras devem enviar o token CSRF e exigir autenticação.

## Mapa global

O mapa usa Leaflet com tiles do OpenStreetMap (com atribuição exibida no mapa). Até a API de propriedades fornecer coordenadas reais, os cinco marcadores representam somente regiões vitivinícolas ilustrativas; não identificam vinícolas reais nem usam dados de sensores. O resumo abre por hover ou por toque/clique no marcador. Na próxima integração, substitua a lista ilustrativa em `src/VineyardMap.jsx` pela resposta da API de propriedades com identificador, nome, região, país e coordenadas `latitude`/`longitude`.

## Funcionalidades ainda não implementadas no painel

As telas e operações de ambientes, dispositivos e limites ainda não estão integradas, apesar das rotas agora estarem definidas. A interface mantém essas funções indisponíveis até implementar os contratos de requisição e resposta correspondentes. Leituras atuais e histórico continuam nas rotas do Express e não dependem da sessão Java. A avaliação e o acionamento de alertas precisam ser implementados pelo backend/dispositivo, para continuar funcionando quando o painel estiver fechado.

## Validação e publicação

```bash
npm run lint
npm run build
```

A publicação deve servir `dist` por Nginx e encaminhar `/api/` ao Express. Não utilize o servidor de desenvolvimento do Vite em produção. Configure o endereço do backend na infraestrutura de publicação, não no código-fonte versionado.
