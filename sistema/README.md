# Ateliê Jessica — sistema de gestão

Sistema web (celular, tablet e computador, instalável como app) para ateliê de costura: clientes, medidas, ordens de serviço com várias peças, produção (Kanban), agenda com provas e capacidade por horas, fotos, etiquetas com QR Code, estoque, pagamentos, caixa, contas a pagar, relatórios e WhatsApp. Roda na Cloudflare (Workers + D1 + R2).

```bash
npm install            # se der erro de dependências: npm install --legacy-peer-deps
npm run check          # tipos + testes (60)
npm run db:migrate:local && npm run dev   # http://localhost:8787 (crie .dev.vars com SETUP_TOKEN)
```

- `docs/FASE-1-ENTREGA.md` e `docs/ENTREGA-FASES-2-A-5.md`: o que foi entregue, testes e pendências
- `docs/ARQUITETURA.md`: decisões, segurança e integridade dos dados
- `docs/IMPLANTACAO.md`: como publicar (homologação primeiro)
- `docs/BACKUP-E-RESTAURACAO.md`: backup diário e restauração testada
