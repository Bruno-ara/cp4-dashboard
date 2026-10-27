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

O Vite encaminha `/api` para o endereço configurado em `VITE_API_TARGET`. O proxy fica desativado quando essa variável não está definida. `VITE_API_TIMEOUT_MS` configura o prazo por consulta e `VITE_API_REFRESH_INTERVAL_MS` configura a atualização das leituras e do histórico; ambos são milissegundos e usam os valores acima como padrão. `.env.local` é ignorado pelo Git; não publique nele o endereço da infraestrutura. Reinicie o servidor do Vite após alterar essa configuração:

```bash
npm run dev
```

O React deve continuar usando rotas relativas, como `/api/sensors/WineSensor002/readings`; não inclua o endereço do backend nas chamadas do navegador.

## APIs consultadas

- `GET /api/sensors/WineSensor002/readings`: leitura atual de temperatura, umidade, luminosidade LDR e data informada pela API.
- `GET /api/sensors/WineSensor002/history?attribute=<atributo>&limit=20`: até vinte pontos históricos, com `receivedAt` e `value`.

Os atributos históricos aceitos são `temperature`, `humidity` e `luminosity`; `limit` aceita valores de 1 a 100. A luminosidade é mostrada sem unidade física, pois a escala do LDR ainda não foi calibrada. Horários são exibidos no fuso local do navegador, com o identificador de fuso retornado por `Intl`.

As leituras atuais e o histórico são atualizados a cada 30 segundos sem sobreposição de requisições. Leituras e histórico têm estados independentes de carregamento, falha, timeout e ausência de dados; uma falha de atualização mantém visível a última resposta bem-sucedida. A navegação mobile oferece links diretos para as seções disponíveis. O perfil é identificado apenas como demonstrativo até haver autenticação integrada.

## Mapa global

O mapa usa Leaflet com tiles do OpenStreetMap (com atribuição exibida no mapa). Até a API de propriedades fornecer coordenadas reais, os cinco marcadores representam somente regiões vitivinícolas ilustrativas; não identificam vinícolas reais nem usam dados de sensores. O resumo abre por hover ou por toque/clique no marcador. Na próxima integração, substitua a lista ilustrativa em `src/VineyardMap.jsx` pela resposta da API de propriedades com identificador, nome, região, país e coordenadas `latitude`/`longitude`.

## Funcionalidades pendentes de contrato

As APIs para listar/cadastrar/remover dispositivos, configurar limites e enviar comandos aos alertas físicos ainda não foram definidas. Essas operações são exibidas como indisponíveis e não são executadas pelo navegador. A avaliação e o acionamento de alertas precisam ser implementados pelo backend/dispositivo, para continuar funcionando quando o painel estiver fechado.

## Validação e publicação

```bash
npm run lint
npm run build
```

A publicação deve servir `dist` por Nginx e encaminhar `/api/` ao Express. Não utilize o servidor de desenvolvimento do Vite em produção. Configure o endereço do backend na infraestrutura de publicação, não no código-fonte versionado.
