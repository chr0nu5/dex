# Dex Project

Refatoração do projeto Pokedeiz com TypeScript, Ant Design e Flask API.

## 🏗️ Estrutura do Projeto

```
dex/
├── backend/          # Flask API
│   ├── app.py       # API principal com hot reload
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── files/       # Arquivos enviados via upload
│   └── data/        # Arquivos de dados/fonte
├── frontend/        # React + TypeScript
│   ├── src/
│   ├── public/
│   ├── package.json
│   └── Dockerfile
└── docker-compose.yml
```

## 🚀 Desenvolvimento Local (sem Docker)

### Backend (Flask)

```bash
cd backend
python -m venv venv
source venv/bin/activate  # No Windows: venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

O backend estará disponível em `http://localhost:5001` com:

- ✅ Hot reload habilitado
- ✅ CORS habilitado para desenvolvimento
- ✅ Pastas `files/` e `data/` criadas automaticamente

**Endpoints disponíveis:**

- `GET /api/health` - Health check
- `POST /api/upload` - Upload de arquivos

### Frontend (React)

```bash
cd frontend
npm install
npm run dev
```

O frontend estará disponível em `http://localhost:3000`

**Bibliotecas instaladas:**

- ✅ React 18 + TypeScript 5.7
- ✅ Ant Design 5.22 (componentes e ícones)
- ✅ @reactbits/effect (para efeitos visuais)
- ✅ Proxy configurado para `/api` → `http://localhost:5001`

## 🐳 Produção (com Docker)

Para rodar o projeto completo em produção com um único container servindo tanto a API quanto o frontend:

```bash
docker-compose up --build
```

Isso irá:

1. Construir o frontend (build estático do React)
2. Construir o backend (Flask API)
3. Servir tudo via nginx na porta 80:
   - `/` → Frontend estático (React)
   - `/api/` → Backend (Flask API)

Acesse em `http://localhost`

Para parar:

```bash
docker-compose down
```

## 📝 Notas

- **Desenvolvimento**: Use `npm run dev` para o frontend e `python app.py` para o backend (sem Docker)
- **Produção**: Use `docker-compose up` para build e servir tudo junto
- **Hot Reload**: Habilitado no Flask (`debug=True`)
- **CORS**: Habilitado no Flask para desenvolvimento local
- **Arquivos**: Salvos automaticamente em `backend/uploads/{user_id}/`
- **Dados**: `master.json` em `backend/data/` para enriquecimento
- **User ID**: Gerado automaticamente e salvo no localStorage

## 🎮 Funcionalidades

### Upload e Enriquecimento

1. Acesse `/dex`
2. Arraste e solte um arquivo JSON (formato: `Pokemons-{User}-{DD-MM-YYYY}.json`)
3. O arquivo será processado e enriquecido com:
   - Cálculo de IV percentual e tier (0*, 1*, 2*, 3*, 4\*)
   - Metadados do master.json (tipos, família, stats base)
   - Detecção de Shundo, Nundo, Lucky, Shiny
   - Informações de gênero com símbolos (♂♀⚲)
   - Formatação de movimentos
4. Acompanhe o progresso em tempo real
5. Veja seus arquivos enviados na lista abaixo

### Formato do JSON

```json
{
  "18390674926879953636": {
    "mon_isshiny": "NO",
    "mon_islucky": "NO",
    "mon_weight": 4.17,
    "mon_move_1": "BUG_BITE_FAST",
    "mon_costume": "JAN_2020_NOEVOLVE",
    "mon_height": 0.3,
    "mon_gender": "FEMALE",
    "mon_stamina": 8,
    "mon_attack": 8,
    "mon_name": "WURMPLE",
    "mon_move_2": "STRUGGLE",
    "mon_cp": 131,
    "mon_number": 265,
    "mon_defence": 13
  }
}
```

## 🔧 Próximos Passos

- [x] Sistema de upload com UUID único por usuário
- [x] Enriquecimento de dados com master.json
- [x] Barra de progresso de processamento
- [x] Listagem de arquivos do usuário
- [ ] Sistema de busca e filtros
- [ ] Análise PVP e rankings
- [ ] Sugestão de times
