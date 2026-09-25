// Форма обратной связи (/contact/) → POST /api/feedback (deploy/worker.js, handleFeedback).
(function () {
  'use strict';
  var form = document.getElementById('fbForm');
  if (!form) return;
  var status = document.getElementById('fbStatus');
  var btn = form.querySelector('.fb-submit');
  var openedAt = Date.now();
  var ERRORS = {
    short_message: 'Сообщение слишком короткое — нужно хотя бы 10 символов.',
    no_consent: 'Отметьте согласие на обработку данных.',
    rate_limited: 'Слишком много обращений подряд. Попробуйте через час.',
    too_large: 'Сообщение слишком длинное.'
  };
  function say(text, ok) {
    status.textContent = text;
    status.className = 'fb-status ' + (ok ? 'is-ok' : 'is-err');
  }
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = form.elements;
    var message = f.message.value.trim();
    if (message.length < 10) { say(ERRORS.short_message); f.message.focus(); return; }
    if (!f.consent.checked) { say(ERRORS.no_consent); f.consent.focus(); return; }
    btn.disabled = true;
    say('Отправляем…', true);
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 15000);
    fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        topic: f.topic.value, name: f.name.value, contact: f.contact.value,
        message: message, website: f.website.value, consent: true, t: openedAt
      })
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (r.ok && data.ok) {
          form.reset();
          say('Спасибо! Обращение отправлено.', true);
          return;
        }
        say(ERRORS[data.error] || 'Не удалось отправить (код ' + r.status + '). Попробуйте позже.');
      });
    }).catch(function () {
      say('Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.');
    }).then(function () {
      clearTimeout(timer);
      btn.disabled = false;
    });
  });
})();
