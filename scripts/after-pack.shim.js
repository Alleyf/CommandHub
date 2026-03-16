const path = require('path');
const fs = require('fs');

exports.default = async function(context) {
  // First run the locales cleaner
  await require('./clean-locales.js').default(context);

  // Then run the icon embedder
  await require('./embed-icon.js').default(context);
};
