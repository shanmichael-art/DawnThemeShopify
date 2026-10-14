/*
  Product page behaviours: the sticky buy bar, and every "ask Shan" entry point
  wired into Shopify Inbox.

  Loaded once, deferred, on the product template. Everything is either
  delegated from `document` or driven by classes on <html>, because Dawn
  re-renders the product-info container with innerHTML on variant change —
  a listener bound to an element inside it would be silently dropped.

  STICKY BAR
  Appears once the main Add to Cart has scrolled off the top of the screen and
  hides whenever that button is back in view, so the two are never on screen
  together. While it is up, <html> carries `aeonic-sticky-on`; CSS uses that to
  tuck away Shopify's floating chat bubble, and the bar's own Ask button takes
  over its job — so nothing ever sits on top of the bar's Add to Cart.

  ASK → SHOPIFY INBOX
  <shopify-chat> exposes sendStarterMessage(text, source): it opens the chat and
  sends `text` as the shopper's first message, straight into Inbox. It enforces
  1–500 characters, a source of "suggestion_pill" or "typed", and a live user
  gesture — it throws without one — so it is only ever called synchronously
  from inside a click or submit handler here.

  Each message carries the guitar's title, question first: the notification
  preview on Shan's phone leads with what was asked, and he still knows which
  guitar it is about.

  DEGRADING
  - sendStarterMessage missing or failing → the chat still opens so the shopper
    can type the question themselves.
  - No usable <shopify-chat> at all (Inbox embed switched off) → <html> never
    gets `aeonic-chat-ready`, CSS keeps every ask entry point hidden, and the
    after-description "Ask me anything" link falls through to its real href.
*/
(function () {
  var root = document.documentElement;
  var MAX_LEN = 500; // sendStarterMessage's own ceiling

  /* ------------------------------------------------------------------ chat */

  function getChat() {
    return document.querySelector('shopify-chat');
  }

  // Present in the DOM is not enough: until the widget script upgrades the
  // element, show() and sendStarterMessage() do not exist yet.
  function chatUsable() {
    return !!(getChat() && window.customElements && customElements.get('shopify-chat'));
  }

  function markChatReady() {
    if (!chatUsable()) return false;
    root.classList.add('aeonic-chat-ready');
    return true;
  }

  function openChat() {
    var chat = getChat();
    if (!chat) return;
    try {
      if (typeof chat.show === 'function') return chat.show();
    } catch (e) {}
    try {
      chat.open = true; // `open` is an accessor property, not a method
    } catch (e) {}
  }

  function compose(question, title) {
    question = (question || '').replace(/\s+/g, ' ').trim();
    if (!question) return '';
    if (!title) return question.slice(0, MAX_LEN);
    var suffix = ' (re: ' + title + ')';
    if (suffix.length > 180) suffix = ' (re: ' + title.slice(0, 170) + '…)';
    return question.slice(0, MAX_LEN - suffix.length) + suffix;
  }

  // Resolves 'sent' when the message reached Inbox, 'opened' when we had to
  // fall back to just opening the chat. Never rejects.
  function sendToInbox(text, source) {
    var chat = getChat();
    if (typeof chat.sendStarterMessage !== 'function') {
      openChat();
      return Promise.resolve('opened');
    }
    var pending;
    try {
      pending = chat.sendStarterMessage(text, source);
    } catch (e) {
      openChat();
      return Promise.resolve('opened');
    }
    return Promise.resolve(pending).then(
      function () {
        openChat(); // no-op if the widget already opened itself
        return 'sent';
      },
      function () {
        openChat();
        return 'opened';
      }
    );
  }

  function setBusy(el, busy) {
    if (!el) return;
    el.disabled = busy;
    el.classList.toggle('is-busy', busy);
    if (busy) el.setAttribute('aria-busy', 'true');
    else el.removeAttribute('aria-busy');
  }

  function titleFor(el) {
    var ask = el.closest('[data-aeonic-ask]');
    return ask ? ask.getAttribute('data-product-title') : '';
  }

  document.addEventListener('click', function (event) {
    var target = event.target;
    if (!(target instanceof Element)) return;

    var starter = target.closest('[data-aeonic-starter]');
    if (starter) {
      if (!chatUsable() || starter.disabled) return;
      event.preventDefault();
      var text = compose(starter.getAttribute('data-aeonic-starter'), titleFor(starter));
      if (!text) return;
      setBusy(starter, true);
      sendToInbox(text, 'suggestion_pill').then(function (result) {
        setBusy(starter, false);
        if (result === 'sent') starter.classList.add('is-sent');
      });
      return;
    }

    // Plain "open the chat" entry points: the sticky bar's Ask button and the
    // after-description link. Without a usable chat the link keeps its href.
    var opener = target.closest('[data-aeonic-chat]');
    if (opener && chatUsable()) {
      event.preventDefault();
      openChat();
    }
  });

  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.hasAttribute('data-aeonic-ask-form')) return;
    event.preventDefault();
    if (!chatUsable()) return;

    var input = form.querySelector('[name="question"]');
    var text = compose(input && input.value, titleFor(form));
    if (!text) {
      if (input) input.focus();
      return;
    }
    var send = form.querySelector('[type="submit"]');
    setBusy(send, true);
    sendToInbox(text, 'typed').then(function (result) {
      setBusy(send, false);
      if (result === 'sent' && input) input.value = '';
    });
  });

  // The Inbox embed loads on its own schedule, often after this script runs.
  if (!markChatReady()) {
    if (window.customElements && customElements.whenDefined) {
      customElements.whenDefined('shopify-chat').then(markChatReady);
    }
    var tries = 0;
    var poll = setInterval(function () {
      if (markChatReady() || ++tries > 30) clearInterval(poll);
    }, 500);
  }

  /* ------------------------------------------------------------ sticky bar */

  var bar = document.getElementById('AeonicStickyATC');
  if (!bar) return;

  var buyButton = null;
  var ticking = false;

  function findBuyButton() {
    buyButton = document.querySelector(
      '.product-form__submit, [data-type="add-to-cart-form"] [type="submit"]'
    );
  }

  function updateBar() {
    ticking = false;
    // Dawn swaps the product form out on variant change; re-find a detached button.
    if (!buyButton || !buyButton.isConnected) findBuyButton();
    var show = !!buyButton && buyButton.getBoundingClientRect().bottom < 0;
    if (show === bar.classList.contains('is-visible')) return;

    bar.classList.toggle('is-visible', show);
    bar.setAttribute('aria-hidden', String(!show));
    bar.inert = !show; // keep its buttons out of the tab order while it is off-screen
    root.classList.toggle('aeonic-sticky-on', show);
  }

  function requestUpdate() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(updateBar);
  }

  bar.inert = true;
  findBuyButton();
  window.addEventListener('scroll', requestUpdate, { passive: true });
  window.addEventListener('resize', requestUpdate);
  updateBar(); // a restored scroll position may already be past the button
})();
