/*
  Product page behaviours: the sticky buy bar, every "ask Shan" entry point
  wired into Shopify Inbox, and the one-of-one "already in your cart" state.

  Loaded once, deferred, on the product template — after Dawn's constants.js
  and pubsub.js, whose PUB_SUB_EVENTS / subscribe() it relies on. Everything is
  either delegated from `document` or driven by classes, because Dawn
  re-renders the product-info container with innerHTML on variant change — a
  listener bound to an element inside it would be silently dropped.

  STICKY BAR
  Appears once the main buttons row has scrolled off the top of the screen and
  hides whenever it is back in view, so the two are never on screen together.
  While it is up, <html> carries `aeonic-sticky-on`; CSS uses that to tuck away
  Shopify's floating chat bubble, and the bar's own Ask button takes over its
  job — so nothing ever sits on top of the bar's Add to Cart.

  ASK → SHOPIFY INBOX
  <shopify-chat> exposes sendStarterMessage(text, source): it opens the chat and
  sends `text` as the shopper's first message, straight into Inbox. It enforces
  1–500 characters, a source of "suggestion_pill" or "typed", and a live user
  gesture — it throws without one — so it is only ever called synchronously
  from inside a click or submit handler here.

  Each message carries the guitar's title, question first: the notification
  preview on Shan's phone leads with what was asked, and he still knows which
  guitar it is about.

  ALREADY IN YOUR CART
  Every guitar is one of one. Once it is in the cart a second Add to cart can
  only fail — and from the sticky bar Dawn reported that failure beside the
  main button, well off-screen, so the tap looked like it did nothing. Both
  Add buttons are therefore swapped for "In your cart — View cart" whenever
  the selected variant is in the cart. Liquid renders the starting state; this
  file keeps it true after an add, after Dawn's own "already in your cart"
  error, after a variant change, and after a back/forward-cache restore.
  Remaining add errors are reported on the sticky bar while it is up.

  DEGRADING
  - sendStarterMessage missing or failing → the chat still opens so the shopper
    can type the question themselves.
  - No usable <shopify-chat> at all (Inbox embed switched off) → <html> never
    gets `aeonic-chat-ready`, CSS keeps every ask entry point hidden, and the
    after-description "Ask me anything" link falls through to its real href.
  - Cart lookup fails → the server-rendered in-cart state stands.
*/
(function () {
  var root = document.documentElement;
  var bar = document.getElementById('AeonicStickyATC');
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

  /* --------------------------------------------------- already in your cart */

  var cartVariants = null; // Set of variant ids (strings); null until known

  // Anything carrying data-aeonic-variant — the main buttons row and the
  // sticky bar — gets `.is-in-cart` while that variant is in the cart.
  function applyCartState() {
    if (!cartVariants) return;
    var els = document.querySelectorAll('[data-aeonic-variant]');
    for (var i = 0; i < els.length; i++) {
      els[i].classList.toggle('is-in-cart', cartVariants.has(els[i].getAttribute('data-aeonic-variant')));
    }
  }

  function setCart(items) {
    cartVariants = new Set(
      items.map(function (item) {
        return String(item.variant_id);
      })
    );
    applyCartState();
  }

  function markInCart(variantId) {
    if (!variantId) return;
    if (!cartVariants) cartVariants = new Set();
    cartVariants.add(String(variantId));
    applyCartState();
  }

  function syncFromCart() {
    var base = (window.routes && window.routes.cart_url) || '/cart';
    return fetch(base + '.js', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (res) {
        return res.json();
      })
      .then(function (cart) {
        setCart(cart.items || []);
      })
      .catch(function () {}); // keep the server-rendered state
  }

  // Shopify words "this one-of-one is already in your cart" a few ways.
  var ALREADY_IN_CART = /already in your cart|are in your cart|can['’]t add more/i;

  function errorText(event) {
    if (!event) return '';
    var errors = event.errors;
    if (typeof errors === 'string') return errors;
    if (errors && typeof errors === 'object') {
      var parts = [];
      Object.keys(errors).forEach(function (key) {
        parts = parts.concat(errors[key]);
      });
      if (parts.length) return parts.join(' ');
    }
    return typeof event.message === 'string' ? event.message : '';
  }

  var flashTimer;
  function flashOnBar(text) {
    if (!bar || !bar.classList.contains('is-visible') || !text) return;
    var msg = bar.querySelector('.aeonic-sticky-atc__msg');
    if (!msg) return;
    msg.textContent = text;
    msg.hidden = false;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () {
      msg.hidden = true;
    }, 6000);
  }

  if (typeof subscribe === 'function' && typeof PUB_SUB_EVENTS !== 'undefined') {
    subscribe(PUB_SUB_EVENTS.cartUpdate, function (event) {
      if (!event) return;
      var cart = event.cartData;
      if (cart && Array.isArray(cart.items)) setCart(cart.items); // a full cart (cart page / drawer)
      else if (event.source === 'product-form') markInCart(event.productVariantId);
    });

    subscribe(PUB_SUB_EVENTS.cartError, function (event) {
      var text = errorText(event);
      if (ALREADY_IN_CART.test(text)) {
        markInCart(event && event.productVariantId);
        flashOnBar('This guitar is already in your cart.');
        // Dawn writes its own "maximum quantity" message straight after
        // publishing this event; the In-your-cart button now says it better.
        setTimeout(function () {
          var wrappers = document.querySelectorAll('.product-form__error-message-wrapper');
          for (var i = 0; i < wrappers.length; i++) wrappers[i].hidden = true;
        }, 0);
        return;
      }
      flashOnBar(text || 'That didn’t go through. Please try again.');
    });

    subscribe(PUB_SUB_EVENTS.variantChange, function (event) {
      var variant = event && event.data && event.data.variant;
      if (variant && bar) bar.setAttribute('data-aeonic-variant', String(variant.id));
      setTimeout(applyCartState, 0); // once Dawn has swapped in the new variant's markup
    });
  }

  syncFromCart();
  // A back/forward-cache restore shows the page exactly as it was left — even
  // if the guitar has since been taken out of the cart on the cart page.
  window.addEventListener('pageshow', function (event) {
    if (event.persisted) syncFromCart();
  });

  /* ------------------------------------------------------------ sticky bar */

  if (!bar) return;

  var buyAnchor = null;
  var ticking = false;

  // The whole buttons row rather than the Add button: the row stays visible
  // in the in-cart state (when Add is swapped out), and because it includes
  // Buy with Shop the bar waits until both have left the screen.
  function findBuyAnchor() {
    buyAnchor =
      document.querySelector('product-info .product-form__buttons') ||
      document.querySelector('.product-form__buttons');
  }

  function updateBar() {
    ticking = false;
    // Dawn swaps the product form out on variant change; re-find a detached row.
    if (!buyAnchor || !buyAnchor.isConnected) findBuyAnchor();
    var show = !!buyAnchor && buyAnchor.getBoundingClientRect().bottom < 0;
    if (show === bar.classList.contains('is-visible')) return;

    bar.classList.toggle('is-visible', show);
    bar.setAttribute('aria-hidden', String(!show));
    bar.inert = !show; // keep its buttons out of the tab order while it is off-screen
    root.classList.toggle('aeonic-sticky-on', show);
    if (!show) {
      var msg = bar.querySelector('.aeonic-sticky-atc__msg');
      if (msg) msg.hidden = true;
    }
  }

  function requestUpdate() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(updateBar);
  }

  bar.inert = true;
  findBuyAnchor();
  window.addEventListener('scroll', requestUpdate, { passive: true });
  window.addEventListener('resize', requestUpdate);
  updateBar(); // a restored scroll position may already be past the buttons
})();
