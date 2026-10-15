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
        style.textContent = ':host{position:fixed;bottom:22px;'+side+':22px;z-index:2147483000;font-family:Arial,sans-serif}button{width:54px;height:54px;border:0;border-radius:50%;background:'+color+';color:#273b2c;font-size:25px;cursor:pointer;box-shadow:0 4px 20px #0002}iframe{position:absolute;bottom:68px;'+side+':0;width:380px;height:600px;max-width:calc(100vw - 28px);max-height:calc(100dvh - 110px);border:1px solid #dce4d0;border-radius:18px;box-shadow:0 12px 60px #0002;background:#f8faf3}iframe[hidden]{display:none}';
        const frame = document.createElement('iframe');
        frame.src = bot.chat_url;
        frame.title = 'Chat with ' + bot.name;
        frame.referrerPolicy = 'strict-origin-when-cross-origin';
        frame.hidden = true;
        const button = document.createElement('button');
        button.textContent = '✦';
        button.setAttribute('aria-label', 'Open chat with ' + bot.name);
        button.setAttribute('aria-expanded', 'false');
        button.onclick = () => {frame.hidden = !frame.hidden;button.textContent = frame.hidden ? '✦' : '×';button.setAttribute('aria-expanded',String(!frame.hidden));};
        shadow.append(style,frame,button);
      } catch (error) {console.warn('AgentForge widget could not load.');}
    }
  }
  if (!customElements.get('agentforge-widget')) customElements.define('agentforge-widget',AgentForgeWidget);
  document.body.appendChild(document.createElement('agentforge-widget'));
})();
