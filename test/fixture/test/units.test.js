module.exports = ({ suite, test, sandbox }) => {
  const sb = sandbox();

  suite('Units');
  test('an inch is 72 points', (t) => t.near(sb.toPt_(1, 'IN'), 72));
  test('properties really store', (t) => {
    sb.saveUnit('CM');
    t.equal(sb.readUnit(), 'CM');
  });

  suite('Requests');
  test('the margin request carries a field mask', (t) => {
    sb.$.reset();
    sb.widenMargins(36);
    const [payload, docId] = sb.$.args('Docs.Documents.batchUpdate')[0];
    t.equal(payload.requests[0].updateDocumentStyle.fields, 'marginLeft');
    t.equal(payload.requests[0].updateDocumentStyle.documentStyle.marginLeft.magnitude, 36);
    t.ok(docId, 'the document id is passed');
  });

  suite('Templates');
  test('the sidebar expands its includes', (t) => {
    t.match(sb.showSidebar(), /id="part"/);
  });
};
