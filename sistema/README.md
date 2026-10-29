# Ateliê Jessica — sistema de gestão

Sistema web (celular, tablet e computador) para ateliê de costura: clientes, medidas, ordens de serviço com várias peças, produção, fotos, pagamentos, caixa e WhatsApp. Roda na Cloudflare (Workers + D1 + R2).

```bash
npm install            # se der erro de dependências: npm install --legacy-peer-deps
npm run check          # tipos + testes (45)
npm run db:migrate:local && npm run dev   # http://localhost:8787 (crie .dev.vars com SETUP_TOKEN)
```

- `docs/FASE-1-ENTREGA.md`: o que foi entregue, testes e pendências
- `docs/ARQUITETURA.md`: decisões, segurança e integridade dos dados
- `docs/IMPLANTACAO.md`: como publicar (homologação primeiro)
- `docs/BACKUP-E-RESTAURACAO.md`: backup diário e restauração testada
