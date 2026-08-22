function widenMargins(pt) {
  var requests = [{
    updateDocumentStyle: {
      documentStyle: { marginLeft: { magnitude: toPt_(pt, 'PT'), unit: 'PT' } },
      fields: 'marginLeft'
    }
  }];
  return Docs.Documents.batchUpdate({ requests: requests }, DocumentApp.getActiveDocument().getId());
}

function showSidebar() {
  var html = HtmlService.createTemplateFromFile('Sidebar').evaluate();
  DocumentApp.getUi().showSidebar(html);
  return html.getContent();
}
