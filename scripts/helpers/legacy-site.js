// Test fixture: the pre-v2 shape of a v2 site (what the previous version saved) — features.call, no policy fields.
module.exports = function legacySite(site) {
  const s = structuredClone(site), f = s.features || {};
  for (const k of ['featurePolicyVersion', 'serviceProfile', 'customerCancel', 'service']) delete s[k];
  s.features = { call: f.callStaff === true, guide: f.guide === true, order: f.order === true, pay: f.pay === true };
  if (s.payment) delete s.payment.verification;
  return s;
};
