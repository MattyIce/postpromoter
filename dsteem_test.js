var fs = require("fs");
var steem = require('steem');
var dsteem = require('dsteem');
var utils = require('./utils');
var config = require('./config');


//var client = client = new dsteem.Client('https://testnet.steemitdev.com');

//utils.updateSteemVariables(client);

steem.api.setOptions({ url: 'https://testnet.steemitdev.com' });
steem.broadcast.claimAccountAsync(config.active_key, config.account, '0.000 TESTS', []).then((result) => { console.log('result'); }, e => console.log(e));

//var op = ['claim_account', { creator: 'postpromoter', fee: '0.000 TESTS', extensions: [] }];
//client.broadcast.sendOperations([op], dsteem.PrivateKey.fromString(config.active_key)).then(r => console.log(r), e => console.log(e));

//client.database.getAccounts(['postpromoter']).then(function (result) { console.log(result); });

//client.broadcast.transfer({ amount: '1.000 TESTS', from: 'yabapmatt', to: 'yabapmatt', memo: 'Testnet tx' }, 
//	dsteem.PrivateKey.fromString('5KhtX2BMB6wosHpCrpyQaFBq76y8nMvhKQqn6x56g6x42518bB2')).then(r => console.log(r), e => console.log(e));
  

/*
client.database.call('get_content', ['postpromoter', 'post-promoter-curation-initiative-weekly-curation-report-1']).then(function (result) {
  console.log(JSON.stringify(result, null, 2));
}, function(err) { console.log(err); });
*/

var comment = { 
	author: 'yabapmatt', 
	permlink: 'testnet-post-yabapmatt', 
	parent_author: 'steem',
	parent_permlink: '',
	title: 'yabapmatt testnet post', 
	body: 'yabapmatt testnet post', 
	json_metadata: '' 
};

// Broadcast the comment
//client.broadcast.comment(comment, dsteem.PrivateKey.fromString('5K79rQPami8ohKWm2X71YVkv82Fmffx7HFzMdcs4aeYxty75vXk'))
//	.then(r => console.log(r), e => console.log(e));