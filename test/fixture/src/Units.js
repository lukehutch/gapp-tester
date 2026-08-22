/** A miniature Apps Script project, used to test the tester. */
var PT_PER = { PT: 1, IN: 72, CM: 72 / 2.54 };

function toPt_(value, unit) { return Number(value) * PT_PER[unit]; }

function saveUnit(unit) {
  PropertiesService.getUserProperties().setProperty('unit', unit);
  return unit;
}

function readUnit() {
  return PropertiesService.getUserProperties().getProperty('unit');
}
