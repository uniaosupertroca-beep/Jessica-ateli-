import { api } from '../api.js';
import { $, comBotao, esc } from '../ui.js';

function formulario(el, { titulo, texto, campos, botao, enviar }) {
  el.innerHTML = `<div class="login"><form class="panel" novalidate>
      <div class="brand" style="padding:0"><b>Ateliê Jessica</b><span>Gestão do ateliê</span></div>
      <div class="fita" aria-hidden="true" style="margin:0"></div>
      <h1 style="font-size:1.35rem">${esc(titulo)}</h1>${texto ? `<p class="muted" style="margin:0">${texto}</p>` : ''}
      ${campos}
      <div id="login-erro" class="alert a-crit" hidden role="alert"></div>
      <button class="btn pri" type="submit">${esc(botao)}</button></form></div>`;
  const form = $('form', el);
  form.addEventListener('submit', e => {
    e.preventDefault();
    comBotao($('button[type=submit]', form), async () => {
      $('#login-erro').hidden = true;
      try {
        await enviar(Object.fromEntries(new FormData(form)));
      } catch (err) {
        $('#login-erro').textContent = err.message;
        $('#login-erro').hidden = false;
      }
    });
  });
  $('input', form)?.focus();
}

export function telaLogin(el, aoEntrar) {
  formulario(el, {
    titulo: 'Entrar',
    campos: `<div class="field"><label for="l-email">E-mail</label><input class="in" id="l-email" name="email" type="email" autocomplete="username" required></div>
      <div class="field"><label for="l-senha">Senha</label><input class="in" id="l-senha" name="senha" type="password" autocomplete="current-password" required></div>`,
    botao: 'Entrar',
    async enviar(d) {
      await api('/auth/entrar', { corpo: { email: d.email, senha: d.senha } });
      aoEntrar();
    },
  });
}

export function telaConfigurarInicial(el, aoEntrar) {
  formulario(el, {
    titulo: 'Primeiro acesso',
    texto: 'Crie a conta da administradora. Use o código de configuração definido na instalação.',
    campos: `<div class="field"><label for="c-token">Código de configuração</label><input class="in" id="c-token" name="token" autocomplete="off" required></div>
      <div class="field"><label for="c-nome">Seu nome</label><input class="in" id="c-nome" name="nome" autocomplete="name" required></div>
      <div class="field"><label for="c-email">E-mail</label><input class="in" id="c-email" name="email" type="email" autocomplete="username" required></div>
      <div class="field"><label for="c-senha">Senha (mínimo 10 caracteres)</label><input class="in" id="c-senha" name="senha" type="password" autocomplete="new-password" minlength="10" required></div>`,
    botao: 'Criar conta e entrar',
    async enviar(d) {
      await api('/auth/configurar', { corpo: d });
      aoEntrar();
    },
  });
}
