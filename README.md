# Wineguard — painel web

Painel React e Vite para consultar leituras do sensor WineSensor002 e gerenciar ambientes, dispositivos e limites pela API Wineguard. O frontend usa somente rotas relativas `/api/`; Orion, STH-Comet e MQTT não são acessados diretamente pelo navegador.

## Requisitos

- Node.js e npm instalados.
- Acesso aos serviços Wineguard para visualizar e gerenciar dados reais.

## Executar localmente

```bash
npm install
```

Crie `.env.local` na raiz do projeto usando `.env.example` como modelo:

```env
VITE_API_TARGET=http://<HOST_DO_NODE_EXPRESS>
VITE_API_JAVA_TARGET=http://<HOST_DA_API_JAVA>
VITE_API_TIMEOUT_MS=10000
VITE_API_REFRESH_INTERVAL_MS=30000
```

A API Java/Spring Security atende `/api/auth/*`, `/api/environments` e `/api/devices/*`; Node/Express atende `/api/sensors/*`. Autenticação e gestão são encaminhadas ao mesmo serviço Java para compartilhar o cookie de sessão. O Vite preserva métodos, caminhos e corpos das requisições. `VITE_API_JAVA_TARGET` configura o Java e `VITE_API_TARGET` configura o serviço Node/Express (ou sensores podem usar o override opcional `VITE_API_SENSOR_TARGET`). Não configure destinos de autenticação separados: o login Java e as rotas protegidas de gestão precisam compartilhar a sessão. O navegador continua usando somente a origem local e rotas `/api/`. `VITE_API_TIMEOUT_MS` configura o prazo por consulta e `VITE_API_REFRESH_INTERVAL_MS` configura a atualização das leituras e do histórico; ambos são milissegundos. `.env.local` é ignorado pelo Git; não publique nele endereços de infraestrutura. Reinicie o Vite após alterar essa configuração:

```bash
npm run dev
```

Não inclua endereços do backend nas chamadas do navegador.

## Login, sessão e cookies

Ao abrir o painel, o frontend consulta `GET /api/auth/me`. Se a sessão não existir, apresenta o formulário de login. O envio busca `GET /api/auth/csrf`, envia usuário e senha como `application/x-www-form-urlencoded` para `POST /api/auth/login` e busca um token CSRF novo após o login. O usuário exibido vem da resposta de `/me`. Essas rotas são atendidas pelo Java/Spring Security, no mesmo serviço das rotas de gestão.

O cookie de sessão é gerenciado pelo navegador e enviado com `credentials: same-origin`; o React não o lê nem o grava. Em produção, sirva painel e APIs sob a mesma origem HTTPS e configure o serviço de autenticação para emitir cookie `HttpOnly`, `Secure`, `SameSite=Lax` e `Path=/`, sem `Domain` quando compartilharem a origem. O token CSRF fica somente em memória e é enviado nas escritas protegidas, inclusive no logout. Não há cadastro público ou recuperação de senha. Credenciais não são persistidas em localStorage, no código ou em variáveis `VITE_*`.

No desenvolvimento local, o navegador chama `http://localhost:<porta-do-vite>/api/...` e o proxy encaminha a requisição. Para `/api/auth`, o proxy do Vite remove o atributo `Domain` do cookie de resposta para permitir que o navegador o associe a `localhost`; não remove `Secure`, `HttpOnly` ou `SameSite`. Navegadores modernos tratam `localhost` como contexto potencialmente seguro para cookies `Secure`, mas confirme o comportamento no navegador usado pela equipe; Vite local não substitui o teste final em HTTPS. Não desative CSRF para viabilizar o proxy local.

## APIs

- `GET /api/auth/csrf`, `POST /api/auth/login`, `GET /api/auth/me` e `POST /api/auth/logout`: autenticação por sessão e proteção CSRF, atendidas pelo Java. O frontend também envia o token CSRF atual em todos os POST, PUT e DELETE protegidos; não repete escritas automaticamente.
- `GET /api/sensors/WineSensor002/readings`: leitura atual de temperatura, umidade, luminosidade LDR e data informada pela API.
- `GET /api/sensors/WineSensor002/history?attribute=<atributo>&limit=20`: até vinte pontos históricos, com `receivedAt` e `value`.
- `GET /api/environments` e `POST /api/environments`: lista e cria ambientes. A criação envia `name` e `description`; a resposta inclui `id`, `name` e `description`.
- `GET /api/devices` e `POST /api/devices`: lista e cadastra referências e metadados. A criação envia `name`, `fiwareId`, `mqttDeviceId`, `fiwareType`, `fiwareService`, `fiwareServicePath` e `environmentId`; a resposta também inclui `environmentName` e `active`. `id` é o identificador numérico no banco, `fiwareId` identifica a entidade FIWARE (ex.: `WineSensor002`) e `mqttDeviceId` identifica o cliente MQTT (ex.: `wine002`).
- `GET /api/devices/{deviceId}/limits` e `PUT /api/devices/{deviceId}/limits`: lista e cria/substitui o limite de uma métrica. Corpo: `metric` (`TEMPERATURE`, `HUMIDITY` ou `LUMINOSITY`), `minimumValue`, `maximumValue` e `unit`. É obrigatório informar ao menos um valor; o mínimo não pode superar o máximo.
- `POST /api/devices/{deviceId}/provision`: provisiona no IoT Agent (sem criar usuário, senha ou ACL MQTT); responde `201`.
- `DELETE /api/devices/{deviceId}`: remove o cadastro e responde `204` sem corpo. A interface exige confirmação explícita.
- `POST /api/devices/{deviceId}/commands/alert`: corpo `{"command":"temperature"}`; aceita `normal`, `temperature`, `humidity` ou `luminosity`. HTTP `202` significa aceito para envio, não confirma execução física.
- `POST /api/devices/{deviceId}/configuration`: envia a configuração completa `{temperatureMin, temperatureMax, humidityMin, humidityMax, luminosityMax}` e recebe `202` com uma revisão `PENDING` criada pelo backend. Faixas: temperatura −20..60 °C, no máximo uma casa decimal, intervalo >2 °C; umidade 0..100%, no máximo uma casa decimal, intervalo >6 pontos; luminosidade inteira 200..4095 ADC.
- `GET /api/devices/{deviceId}/configuration`: retorna e reconcilia a configuração mais recente. A UI apresenta `PENDING`, `APPLIED`, `REJECTED` e `UNCONFIRMED`, revisão, valores, `createdAt`, `confirmedAt` e motivo de rejeição. Só chama valores de ativos após `APPLIED`. Após envio, acompanha por GET a cada 5 segundos por até 45 segundos, sem sobreposição. No timeout/erro incerto, permite apenas consulta GET; nunca repete o POST automaticamente nem simula reenvio da mesma revisão.

A API Java também documenta `/api/devices/{deviceId}/readings/current` e `/api/devices/{deviceId}/readings/history/{metric}`, para consultas Orion/STH-Comet. O dashboard continua usando as rotas Express existentes para suas leituras atuais e históricas. Preserve esses prefixos e caminhos na publicação.

Os atributos históricos Express aceitos são `temperature`, `humidity` e `luminosity`; `limit` aceita valores de 1 a 100. A luminosidade é mostrada sem unidade física, pois a escala LDR ainda não foi calibrada. Horários são exibidos no fuso local do navegador.

Leituras e histórico têm estados independentes de carregamento, erro, timeout e ausência de dados; uma falha de atualização preserva a última resposta bem-sucedida. A navegação mobile oferece links diretos para as seções disponíveis.

Leituras atuais e histórico são consultados a cada 30 segundos, sem sobreposição, e o polling é suspenso enquanto a página está oculta. O painel não consulta `/api/auth/me` em intervalos: verifica a sessão ao abrir e ao retornar a uma página antes oculta (ou ao voltar o foco após um intervalo). Uma resposta HTTP 401 de uma chamada de dados encerra a área autenticada centralmente e pede novo login. Uma falha de atualização mantém visível a última resposta bem-sucedida.

O polling das leituras é uma consulta de dados, não um mecanismo de keep-alive intencional. O serviço de autenticação precisa definir com a equipe se chamadas de leitura renovam o timeout ocioso e garantir que polling não mantenha sessões vivas indefinidamente. O teste de sessão só está concluído após verificar essa regra em ambiente real.

## Mapa global

O mapa usa Leaflet com tiles do OpenStreetMap (com atribuição exibida no mapa). Até a API de propriedades fornecer coordenadas reais, os cinco marcadores representam regiões vitivinícolas ilustrativas; não identificam vinícolas reais nem usam dados de sensores. O resumo abre por hover ou toque/clique no marcador.

Na próxima integração do mapa, substitua a lista ilustrativa em `src/VineyardMap.jsx` pela API de propriedades, com identificador, nome, região, país e coordenadas `latitude`/`longitude`.

## Ambientes, dispositivos, limites e ESP

As telas seguem os contratos Java enumerados acima; confirme que a revisão implantada oferece esses endpoints antes de publicar. Cadastro no banco e provisionamento no IoT Agent são ações distintas; uma falha de rede no provisionamento não apaga o cadastro. Limites por métrica são persistência separada e não alteram a configuração ativa do ESP. A configuração completa cria uma revisão e seus valores só passam a ser exibidos como ativos depois que a API Java confirma `APPLIED`. `202` de comando indica aceitação para envio, não execução comprovada. A interface não lê `configure_status` do Orion como confirmação. Avaliação de limites e atuação automática precisam ocorrer no backend/dispositivo, inclusive com o painel fechado.

As consultas limitadas de estado da configuração (até 45 segundos por envio) são necessárias para reconciliar o ESP; o dashboard não usa polling como keep-alive geral. A política de expiração ociosa e a atividade contabilizada por leitura/consulta devem ser confirmadas com o responsável pelo backend antes de afirmar que o polling nunca prolonga sessões.

## Validação

```bash
npm run lint
npm test
npm run build
```

`npm test` executa testes locais com `fetch` simulado; não valida login real, cookie/CSRF no navegador, AWS, HTTPS nem execução física do ESP. O teste final de login, recarga, sessão, rotação CSRF e logout deve ser feito separadamente no ambiente HTTPS ativo, confirmando também o comportamento do cookie no Vite local. Não use credenciais reais em testes versionados.

## Publicação dos serviços

O Java e o Node/Express coexistem; o Java não substitui automaticamente o serviço Express existente na EC2. As notas do backend descrevem uma topologia sugerida para AWS, não uma implantação realizada ou uma pipeline confirmada. Publique cada serviço pela pipeline definida pela equipe; não use o servidor de desenvolvimento do Vite em produção.

1. **Node/Express existente:** preserve sua implantação atual e as rotas `/api/sensors/*`.
2. **API Java:** publique a aplicação Spring Boot com `/api/auth/*`, `/api/environments` e `/api/devices/*`, PostgreSQL/Flyway e conectividade às dependências FIWARE necessárias; confira `/actuator/health`. Armazene segredos no serviço de execução, não no repositório ou imagem.
3. **Frontend:** execute `npm ci`, `npm run lint`, `npm test` e `npm run build`; publique o conteúdo de `dist` no serviço web estático e configure fallback para `index.html` se necessário.

No Nginx/gateway que atende o frontend, encaminhe `/api/auth/`, `/api/environments` e `/api/devices/` à mesma API Java; `/api/sensors/` continua no Node/Express. Preserve prefixos e caminhos. Exemplo conceitual:

```nginx
location /api/auth/ {
    proxy_pass http://wineguard_java;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}

location /api/sensors/ {
    proxy_pass http://wineguard_node;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}

location /api/environments {
    proxy_pass http://wineguard_java;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}

location /api/devices {
    proxy_pass http://wineguard_java;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

Mantenha painel e APIs na mesma origem HTTPS pública para que o cookie de sessão funcione com `credentials: same-origin`. Configure endereços de serviço no ambiente de publicação; não versione hostnames privados, credenciais, tokens ou valores `VITE_*` de produção.
