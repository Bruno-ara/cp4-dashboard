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

O Node/Express existente atende `/api/auth/*` e `/api/sensors/*`; a API Java atende `/api/environments` e `/api/devices/*`. O Vite encaminha cada prefixo ao serviço configurado, preservando métodos, caminhos e corpos JSON. `VITE_API_TARGET` continua sendo o destino Node/Express das rotas aprovadas de autenticação e sensores. `VITE_API_JAVA_TARGET` configura separadamente a API Java. As variáveis opcionais `VITE_API_AUTH_TARGET` e `VITE_API_SENSOR_TARGET` permitem sobrescrever individualmente os destinos legados. O navegador continua usando somente a origem local e rotas `/api/`. O proxy fica desativado para cada serviço quando seu destino não está configurado. `VITE_API_TIMEOUT_MS` configura o prazo por consulta e `VITE_API_REFRESH_INTERVAL_MS` configura a atualização das leituras e do histórico; ambos são milissegundos. `.env.local` é ignorado pelo Git; não publique nele endereços de infraestrutura. Reinicie o Vite após alterar essa configuração:

```bash
npm run dev
```

Não inclua endereços do backend nas chamadas do navegador.

## Login, sessão e cookies

Ao abrir o painel, o frontend consulta `GET /api/auth/me`. Se a sessão não existir, apresenta o formulário de login. O envio busca `GET /api/auth/csrf`, envia usuário e senha como `application/x-www-form-urlencoded` para `POST /api/auth/login` e busca um token CSRF novo após o login. O usuário exibido vem da resposta de `/me`. Essas rotas existentes permanecem no Node/Express; a API Java publicada em [wineguard-backend](https://github.com/joao-jps/wineguard-backend) não implementa login/perfis.

O cookie de sessão é gerenciado pelo navegador e enviado com `credentials: same-origin`; o React não o lê nem o grava. Em produção, sirva painel e APIs sob a mesma origem HTTPS e configure o serviço de autenticação para emitir cookie `HttpOnly`, `Secure`, `SameSite=Lax` e `Path=/`, sem `Domain` quando compartilharem a origem. O token CSRF fica somente em memória e é enviado no logout. Não há cadastro público ou recuperação de senha. Credenciais não são persistidas em localStorage, no código ou em variáveis `VITE_*`.

No desenvolvimento local, o navegador chama `http://localhost:<porta-do-vite>/api/...` e o proxy encaminha a requisição. Para `/api/auth`, o proxy do Vite remove o atributo `Domain` do cookie de resposta para permitir que o navegador o associe a `localhost`; não remove `Secure`, `HttpOnly` ou `SameSite`. Navegadores modernos tratam `localhost` como contexto potencialmente seguro para cookies `Secure`, mas valide no navegador usado pela equipe. Não desative CSRF para viabilizar o proxy local.

## APIs

- `GET /api/auth/csrf`, `POST /api/auth/login`, `GET /api/auth/me` e `POST /api/auth/logout`: autenticação por sessão e proteção CSRF, mantidas no serviço existente.
- `GET /api/sensors/WineSensor002/readings`: leitura atual de temperatura, umidade, luminosidade LDR e data informada pela API.
- `GET /api/sensors/WineSensor002/history?attribute=<atributo>&limit=20`: até vinte pontos históricos, com `receivedAt` e `value`.
- `GET /api/environments` e `POST /api/environments`: lista e cria ambientes. A criação envia `name` e `description`; a resposta inclui `id`, `name` e `description`.
- `GET /api/devices` e `POST /api/devices`: lista e cadastra referências e metadados FIWARE. A criação envia `name`, `fiwareId`, `fiwareType`, `fiwareService`, `fiwareServicePath` e `environmentId`; a resposta também inclui `environmentName` e `active`.
- `GET /api/devices/{deviceId}/limits` e `PUT /api/devices/{deviceId}/limits`: lista e cria/substitui o limite de uma métrica. Corpo: `metric` (`TEMPERATURE`, `HUMIDITY` ou `LUMINOSITY`), `minimumValue`, `maximumValue` e `unit`. É obrigatório informar ao menos um valor; o mínimo não pode superar o máximo.

A API Java também documenta `/api/devices/{deviceId}/readings/current` e `/api/devices/{deviceId}/readings/history/{metric}`, para consultas Orion/STH-Comet. O dashboard continua usando as rotas Express existentes para suas leituras atuais e históricas. Preserve esses prefixos e caminhos na publicação.

Os atributos históricos Express aceitos são `temperature`, `humidity` e `luminosity`; `limit` aceita valores de 1 a 100. A luminosidade é mostrada sem unidade física, pois a escala LDR ainda não foi calibrada. Horários são exibidos no fuso local do navegador.

Leituras e histórico têm estados independentes de carregamento, erro, timeout e ausência de dados; uma falha de atualização preserva a última resposta bem-sucedida. A navegação mobile oferece links diretos para as seções disponíveis.

Leituras atuais e histórico são consultados a cada 30 segundos, sem sobreposição, e o polling é suspenso enquanto a página está oculta. O painel não consulta `/api/auth/me` em intervalos: verifica a sessão ao abrir e ao retornar a uma página antes oculta (ou ao voltar o foco após um intervalo). Uma resposta HTTP 401 de uma chamada de dados encerra a área autenticada centralmente e pede novo login. Uma falha de atualização mantém visível a última resposta bem-sucedida.

O polling das leituras é uma consulta de dados, não um mecanismo de keep-alive intencional. O serviço de autenticação precisa definir com a equipe se chamadas de leitura renovam o timeout ocioso e garantir que polling não mantenha sessões vivas indefinidamente. O teste de sessão só está concluído após verificar essa regra em ambiente real.

## Mapa global

O mapa usa Leaflet com tiles do OpenStreetMap (com atribuição exibida no mapa). Até a API de propriedades fornecer coordenadas reais, os cinco marcadores representam regiões vitivinícolas ilustrativas; não identificam vinícolas reais nem usam dados de sensores. O resumo abre por hover ou toque/clique no marcador.

Na próxima integração do mapa, substitua a lista ilustrativa em `src/VineyardMap.jsx` pela API de propriedades, com identificador, nome, região, país e coordenadas `latitude`/`longitude`.

## Ambientes, dispositivos e limites

As telas usam os contratos descritos no repositório [wineguard-backend](https://github.com/joao-jps/wineguard-backend). O cadastro Java de dispositivo persiste metadados e não cria nem provisiona uma entidade no FIWARE. Salvar limites persiste a configuração e não aciona automaticamente o ESP. Remoção de dispositivos e comandos remotos continuam indisponíveis porque não há endpoints para essas ações. A avaliação de limites e o acionamento de alertas precisam ser executados pelo backend/dispositivo para funcionar com o painel fechado. Confirme com a equipe técnica as faixas e unidades dos sensores antes de definir limites operacionais.

**Atenção à autorização:** a documentação Java atual afirma que o backend não implementa login/perfis. O login já aprovado no frontend continua no serviço existente e a tela de gestão só aparece após a sessão do painel, mas isso não protege por si só as rotas Java. Antes de expor `/api/environments` ou `/api/devices` publicamente, a equipe deve aplicar autorização no Java ou em um gateway confiável.

## Validação

```bash
npm run lint
npm test
npm run build
```

## Publicação dos serviços

O Java e o Node/Express coexistem; o Java não substitui automaticamente o serviço Express existente na EC2. As notas do backend descrevem uma topologia sugerida para AWS, não uma implantação realizada ou uma pipeline confirmada. Publique cada serviço pela pipeline definida pela equipe; não use o servidor de desenvolvimento do Vite em produção.

1. **Node/Express existente:** preserve sua implantação atual e as rotas `/api/auth/*` e `/api/sensors/*`.
2. **API Java:** publique a aplicação Spring Boot com PostgreSQL/Flyway e conectividade de rede às dependências FIWARE necessárias; confira `/actuator/health`. Armazene segredos no serviço de execução, não no repositório ou imagem. Configure autorização antes de liberar endpoints de cadastro.
3. **Frontend:** execute `npm ci`, `npm run lint`, `npm test` e `npm run build`; publique o conteúdo de `dist` no serviço web estático e configure fallback para `index.html` se necessário.

No Nginx/gateway que atende o frontend, encaminhe `/api/auth/` e `/api/sensors/` ao Node/Express e `/api/environments` e `/api/devices/` à API Java, preservando os prefixos e caminhos. Exemplo conceitual (substitua upstreams pelos nomes internos reais e adicione controle de acesso às rotas Java):

```nginx
location /api/auth/ {
    proxy_pass http://wineguard_node;
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
