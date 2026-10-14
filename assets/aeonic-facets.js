/*
  Collection and search page sorting — two small changes to Dawn's facets.

  Loaded straight after facets.js wherever Dawn loads it, and only there.

  1. SORT APPLIES IMMEDIATELY
     Dawn waits 800ms after any change to the filter form before it fetches
     results, so ticking several filter boxes in a row costs one request. That
     makes sense for checkboxes, but a sort is a single choice: for the first
     0.8s nothing on the page moved, and SimGym's shopper picked "Price, high to
     low" again because it looked like it had not worked. Sort selects now skip
     the wait — a capture-phase listener on `document` runs before Dawn's
     listener on the form, stops the event there, and hands it straight to the
     same FacetFiltersForm.onSubmitHandler Dawn would have called 0.8s later.
     Filters keep Dawn's wait.

  2. PHONES: CHOOSING A SORT CLOSES THE DRAWER
     On phones, sort lives in the "Filter and sort" drawer. The results re-sort
     behind it, and the only change in front of the shopper was the dropdown
     label. Picking a sort now closes the drawer — the same way Dawn's own Apply
     button does, by clicking the drawer's toggle — so the re-sorted guitars are
     the confirmation. Filters do not close it: people tick several.
*/
(function () {
  var SORT_SELECT = 'facet-filters-form select[name="sort_by"]';

  document.addEventListener(
    'input',
    function (event) {
      var select = event.target;
      if (!(select instanceof HTMLSelectElement) || !select.matches(SORT_SELECT)) return;

      var facets = select.closest('facet-filters-form');
      if (!facets || typeof facets.onSubmitHandler !== 'function') return; // let Dawn handle it

      // Keep Dawn's debounced listener from firing a second, identical request.
      event.stopPropagation();
      facets.onSubmitHandler(event);

      var drawer = select.closest('.mobile-facets__wrapper');
      var disclosure = drawer && drawer.querySelector('details');
      if (disclosure && disclosure.open) {
        var toggle = disclosure.querySelector('summary');
        if (toggle) toggle.click();
      }
    },
    true
  );
})();
