// Окно карточки героя и скрипты, которые его строят (карточку строит js/app.js,
// отдельной копии нет). Подключают статьи с контрпиками и страницы предметов.
module.exports=`<div class="modal" id="modal" role="dialog" aria-modal="true" aria-labelledby="modalContent"><div class="modal-bg" id="modalBg"></div><div class="modal-card"><button class="close" id="close" aria-label="Закрыть">×</button><div id="modalContent"></div></div></div>
<script src="/js/local-preview.js" defer></script>
<script src="/js/reliable-data.js" defer></script>
<script src="/js/item-variants.js" defer></script>
<script src="/js/hero-roles.js" defer></script>
<script src="/js/search.js" defer></script>
<script src="/js/app.js" defer></script>
<script src="/js/v43-features.js" defer></script>
`;
