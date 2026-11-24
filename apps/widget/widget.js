(function () {
  'use strict';
  const script = document.currentScript;
  if (!script || !script.dataset.agentKey || document.querySelector('agentforge-widget')) return;
  const key = script.dataset.agentKey;
  const api = new URL(script.src).origin;
  class AgentForgeWidget extends HTMLElement {
    async connectedCallback() {
      try {
        const response = await fetch(api + '/api/v1/public/widget/' + encodeURIComponent(key));
        if (!response.ok) return;
        const bot = await response.json();
        const shadow = this.attachShadow({mode:'open'});
        const color = /^#[0-9a-f]{6}$/i.test(bot.widget_config.color) ? bot.widget_config.color : '#d6ff63';
        const side = bot.widget_config.position === 'left' ? 'left' : 'right';
        const style = document.createElement('style');
        style.textContent = ':host{position:fixed;bottom:22px;'+side+':22px;z-index:2147483000;font-family:Arial,sans-serif}button{width:54px;height:54px;border:0;border-radius:50%;background:'+color+';color:#273b2c;font-size:25px;cursor:pointer;box-shadow:0 4px 20px #0002;display:grid;place-items:center}button svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}iframe{position:absolute;bottom:68px;'+side+':0;width:380px;height:600px;max-width:calc(100vw - 28px);max-height:calc(100dvh - 110px);border:1px solid #dce4d0;border-radius:18px;box-shadow:0 12px 60px #0002;background:#f8faf3}iframe[hidden]{display:none}';
        const frame = document.createElement('iframe');
        const chatUrl = new URL(bot.chat_url);
        if (script.dataset.userId) chatUrl.searchParams.set('user_id', script.dataset.userId);
        if (script.dataset.userName) chatUrl.searchParams.set('user_name', script.dataset.userName);
        frame.src = chatUrl.toString();
        frame.title = 'Chat with ' + bot.name;
        frame.referrerPolicy = 'strict-origin-when-cross-origin';
        frame.hidden = true;
        const button = document.createElement('button');
        const icons = {
          sparkle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Z"/><path d="m19 14 .9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14Z"/></svg>',
          message: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 8.7 3.9a8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z"/></svg>',
          chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z"/><path d="M8 9h8M8 13h5"/></svg>',
          headset: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 14v-3a9 9 0 0 1 18 0v3"/><path d="M5 14h2a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2Zm14 0h-2a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2Z"/></svg>'
        };
        const launcherIcon = icons[bot.widget_config.launcher_icon] || icons.sparkle;
        button.innerHTML = launcherIcon;
        button.setAttribute('aria-label', 'Open chat with ' + bot.name);
        button.setAttribute('aria-expanded', 'false');
        button.onclick = () => {frame.hidden = !frame.hidden;button.innerHTML = frame.hidden ? launcherIcon : '×';button.setAttribute('aria-expanded',String(!frame.hidden));};
        shadow.append(style,frame,button);
      } catch (error) {console.warn('AgentForge widget could not load.');}
    }
  }
  if (!customElements.get('agentforge-widget')) customElements.define('agentforge-widget',AgentForgeWidget);
  document.body.appendChild(document.createElement('agentforge-widget'));
})();
