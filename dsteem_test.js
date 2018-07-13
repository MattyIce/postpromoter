var fs = require("fs");
var dsteem = require('dsteem');
var utils = require('./utils');

var client = client = new dsteem.Client('https://api.steemit.com');

utils.updateSteemVariables(client);

client.database.call('get_content', ['postpromoter', 'post-promoter-curation-initiative-weekly-curation-report-1']).then(function (result) {
  console.log(JSON.stringify(result, null, 2));
}, function(err) { console.log(err); });